// SPDX-License-Identifier: GPL-2.0-or-later
export function describeClient(agent: string): {
  name: string;
  version: string;
  platform: string;
} {
  const browsers: [string, RegExp][] = [
    ["Edge", /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/],
    ["Opera", /(?:OPR|Opera)\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari\//],
  ];
  const platform = /Android/i.test(agent)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(agent)
      ? "iOS"
      : /Windows/i.test(agent)
        ? "Windows"
        : /Macintosh|Mac OS X/i.test(agent)
          ? "macOS"
          : /Linux/i.test(agent)
            ? "Linux"
            : "";
  for (const [name, pattern] of browsers) {
    const match = agent.match(pattern);
    if (match) return { name, version: match[1], platform };
  }
  const app = agent.match(/^([^\s/]+)\/([^\s]+)/);
  return {
    name: app?.[1] || (agent ? "Other client" : "Unknown client"),
    version: app?.[2] || "",
    platform,
  };
}
