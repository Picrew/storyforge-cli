export const copy = {
  brand: "STORYFORGE",
  subtitle: "A terminal foundry for scenes, arcs, and long-form fiction.",
  welcomeTitle: "Session notes",
  welcomeBody: [
    "Start with /story <premise> to build the world, cast, timeline, and outline.",
    "Use /commit, /render, and /compile to turn approved events into chapters.",
    "Run /help at any time for commands and recovery controls."
  ],
  condensedWelcomeBody: [
    "Start with /story <premise>.",
    "Use /help for commands."
  ],
  placeholder: "Describe a premise, scene, or character...",
  previewNotice: "Story workspace ready.",
  footer: {
    center: "ready",
    right: "story workspace",
    compact: "ready | storyforge"
  }
} as const;
