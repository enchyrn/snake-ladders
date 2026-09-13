/** One palette shared by the 3D scene and the DOM overlay. */
export const palette = {
  void: "#080b10",
  boardDark: "#12202a",
  boardLight: "#172b36",
  boardEdge: "#0b1419",
  revealed: "#1f3a47",
  revealedEdge: "#2b5063",
  ladder: "#e8d6a0",
  ladderDark: "#b9a36f",
  snake: "#2f8f5b",
  snakeDark: "#1d5c3a",
  snakeHead: "#48c07c",
  mine: "#d9455f",
  flag: "#f2a33c",
  text: "#cfe4ec",
  textDim: "#5d7b89",
  start: "#3d6f86",
  finish: "#d9b64a",
} as const

/** Token colours, assigned by seat. Distinct in both hue and lightness so
 *  they stay tellable apart for colour-blind players and on a dim phone. */
export const seatColours = [
  "#4cc2ff", // cyan
  "#ff6b5a", // coral
  "#ffd24c", // amber
  "#9b7bff", // violet
  "#4ee39b", // mint
  "#ff8fd0", // pink
] as const

export const seatColour = (seat: number): string =>
  seatColours[seat % seatColours.length]!

/** Minesweeper's familiar count colouring, tuned for a dark board. */
export const countColour = (n: number): string =>
  ["#000000", "#6fb3ff", "#5fd39a", "#ff8f6b", "#ffc861", "#ff7b9c", "#69e0d2", "#cfd8dc", "#9aa7ad"][
    Math.min(n, 8)
  ]!
