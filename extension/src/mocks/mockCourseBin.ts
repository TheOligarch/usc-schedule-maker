/**
 * Stand-in for the WebReg content script in demo mode (`npm run dev:mock`), so the
 * "Add to myCourseBin" flow can be tried without WebReg. Nothing leaves the page.
 */
import type { BinTransport } from "../lib/courseBin";

export function mockBinTransport(delayMs = 350): BinTransport {
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  let n = 0;
  return {
    async prepare(req) {
      await wait();
      return { ok: true, activeTerm: req.termCode };
    },
    async add() {
      await wait();
      n++;
      return n % 5 === 0 ? { outcome: "already", message: "Demo: this section is already in your myCourseBin." } : { outcome: "added", message: null };
    },
  };
}
