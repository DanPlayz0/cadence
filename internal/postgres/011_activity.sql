-- SPDX-License-Identifier: GPL-2.0-or-later
CREATE TABLE activity_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created timestamptz NOT NULL DEFAULT now(),
 level text NOT NULL CHECK(level IN ('Information','Warning','Error')),
 user_id text NOT NULL DEFAULT '',
 user_name text NOT NULL DEFAULT '',
 name text NOT NULL,
 overview text NOT NULL DEFAULT '',
 type text NOT NULL
);
CREATE INDEX activity_recent ON activity_log(created DESC,id DESC);
CREATE INDEX activity_user_recent ON activity_log(user_id,created DESC,id DESC);
-- Events are written in the same transaction as the change they describe.
CREATE FUNCTION record_activity_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 uid text := ''; uname text := ''; title text; detail text := ''; kind text; severity text := 'Information'; issue_count integer := 0;
BEGIN
 IF TG_TABLE_NAME='session_devices' THEN
  SELECT u.id,u.display_name INTO uid,uname FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=NEW.token;
  title := uname || ' signed in'; kind := 'SessionStarted'; detail := NEW.user_agent;
 ELSIF TG_TABLE_NAME='sessions' THEN
  SELECT id,display_name INTO uid,uname FROM users WHERE id=OLD.user_id;
  uid := coalesce(uid,OLD.user_id); uname := coalesce(uname,'Deleted user');
  title := uname || ' session ended'; kind := 'SessionEnded';
  detail := CASE WHEN OLD.expires<=now() THEN 'Session expired' ELSE 'Signed out or session revoked' END;
 ELSIF TG_TABLE_NAME='users' THEN
  IF TG_OP='DELETE' THEN uid := OLD.id; uname := OLD.display_name; title := uname || ' account deleted'; kind := 'UserDeleted';
  ELSE
   uid := NEW.id; uname := NEW.display_name;
   IF TG_OP='INSERT' THEN title := uname || ' account created'; kind := 'UserCreated';
   ELSIF NEW.password IS DISTINCT FROM OLD.password THEN title := uname || ' password changed'; kind := 'UserPasswordChanged';
   ELSIF NEW.username IS DISTINCT FROM OLD.username OR NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.admin IS DISTINCT FROM OLD.admin THEN title := uname || ' account updated'; kind := 'UserUpdated';
   ELSE RETURN NULL;
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='plays' THEN
  uid := NEW.user_id; SELECT display_name INTO uname FROM users WHERE id=uid;
  SELECT coalesce(overrides->>'title',tracks.title) || ' — ' || coalesce(overrides->>'artist',artist) INTO detail FROM tracks WHERE id=NEW.track_id;
  title := uname || ' listened to ' || coalesce(detail,'a track'); kind := 'AudioPlayed'; detail := 'Play recorded in listening history';
 ELSIF TG_TABLE_NAME='scans' THEN
  IF TG_OP='INSERT' THEN title := 'Library scan started'; kind := 'ScanStarted';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
   IF jsonb_typeof(NEW.errors)='array' THEN issue_count := jsonb_array_length(NEW.errors); END IF;
   title := 'Library scan ' || replace(NEW.status,'_',' '); kind := 'ScanCompleted';
   detail := NEW.indexed || ' files indexed; ' || issue_count || ' reported issues';
   IF NEW.status='failed' THEN severity := 'Error'; ELSIF issue_count>0 OR NEW.status='interrupted' THEN severity := 'Warning'; END IF;
  ELSE RETURN NULL;
  END IF;
 ELSIF TG_TABLE_NAME='instance_settings' THEN
  IF NEW.value IS NOT DISTINCT FROM OLD.value THEN RETURN NULL; END IF;
  title := 'Instance branding changed'; kind := 'BrandingChanged'; detail := 'Instance name: ' || NEW.value;
 ELSIF TG_TABLE_NAME='settings' THEN
  IF NEW.enabled IS NOT DISTINCT FROM OLD.enabled THEN RETURN NULL; END IF;
  title := 'Metadata enrichment ' || CASE WHEN NEW.enabled THEN 'enabled' ELSE 'disabled' END; kind := 'SettingsChanged';
 ELSIF TG_TABLE_NAME='groups' THEN
  IF TG_OP='INSERT' THEN title := 'Group created: ' || NEW.name; kind := 'GroupCreated'; ELSE title := 'Group removed: ' || OLD.name; kind := 'GroupDeleted'; END IF;
 ELSIF TG_TABLE_NAME='exclusions' THEN
  IF TG_OP='INSERT' THEN title := 'Library exclusion added'; detail := NEW.kind || ': ' || NEW.target; ELSE title := 'Library exclusion removed'; detail := OLD.kind || ': ' || OLD.target; END IF;
  kind := 'AccessChanged';
 ELSIF TG_TABLE_NAME='user_groups' THEN
  IF TG_OP='INSERT' THEN uid := NEW.user_id; ELSE uid := OLD.user_id; END IF;
  SELECT display_name INTO uname FROM users WHERE id=uid;
  title := coalesce(uname,'Deleted user') || ' group membership changed'; kind := 'UserGroupsChanged';
 END IF;
 INSERT INTO activity_log(level,user_id,user_name,name,overview,type) VALUES(severity,coalesce(uid,''),coalesce(uname,''),title,coalesce(detail,''),kind);
 RETURN NULL;
END $$;
CREATE TRIGGER device_activity AFTER INSERT ON session_devices FOR EACH ROW EXECUTE FUNCTION record_activity_change();
CREATE TRIGGER session_activity AFTER DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION record_activity_change();
CREATE TRIGGER user_activity AFTER INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION record_activity_change();
CREATE TRIGGER play_activity AFTER INSERT ON plays FOR EACH ROW EXECUTE FUNCTION record_activity_change();
CREATE TRIGGER scan_activity AFTER INSERT OR UPDATE ON scans FOR EACH ROW EXECUTE FUNCTION record_activity_change();
CREATE TRIGGER branding_activity AFTER UPDATE ON instance_settings FOR EACH ROW EXECUTE FUNCTION record_activity_change();
CREATE TRIGGER settings_activity AFTER UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION record_activity_change();
CREATE TRIGGER group_activity AFTER INSERT OR DELETE ON groups FOR EACH ROW EXECUTE FUNCTION record_activity_change();
CREATE TRIGGER exclusion_activity AFTER INSERT OR DELETE ON exclusions FOR EACH ROW EXECUTE FUNCTION record_activity_change();
CREATE TRIGGER membership_activity AFTER INSERT OR DELETE ON user_groups FOR EACH ROW EXECUTE FUNCTION record_activity_change();
