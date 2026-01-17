const { createApp } = Vue;

/**
 * Paste your 16 dice here.
 * 16 items, each an array of faces (strings). Use "Qu" for Qu.
 */
const DICE = [
  // TODO: replace with your real 16 dice
  ["A", "A", "E", "E", "G", "N"],
  ["E", "L", "R", "T", "T", "Y"],
  ["A", "O", "O", "T", "T", "W"],
  ["A", "B", "B", "J", "O", "O"],
  ["E", "H", "R", "T", "V", "W"],
  ["C", "I", "M", "O", "T", "U"],
  ["D", "I", "S", "T", "T", "Y"],
  ["E", "I", "O", "S", "S", "T"],
  ["D", "E", "L", "R", "V", "Y"],
  ["A", "C", "H", "O", "P", "S"],
  ["H", "I", "M", "N", "Qu", "U"],
  ["E", "E", "I", "N", "S", "U"],
  ["E", "E", "G", "H", "N", "W"],
  ["A", "F", "F", "K", "P", "S"],
  ["H", "L", "N", "N", "R", "Z"],
  ["D", "E", "I", "L", "R", "X"]
];

// ---- Trie helpers for solver ----
function makeNode() {
  return { next: Object.create(null), end: false };
}
function trieInsert(root, word) {
  let node = root;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    node = node.next[ch] || (node.next[ch] = makeNode());
  }
  node.end = true;
}

createApp({
  data() {
    return {
      // Board
      grid: [
        ["T", "A", "P", "E"],
        ["R", "S", "L", "N"],
        ["O", "I", "D", "M"],
        ["C", "H", "U", "G"]
      ],

      // Dictionary
      dictReady: false,
      dict: new Set(),

      // Solver structures
      trieRoot: makeNode(),
      solving: false,
      showSolutions: false,
      allSolutions: [],     // UPPERCASE strings
      missedSolutions: [],  // UPPERCASE strings

      // Timer
      gameLengthSec: 10,
      gameLengthSecRegular: 10,
      gameLengthSecLongest: 8,
      timeLeftSec: 180,
      timerId: null,
      gameOver: false,

      // Mode / seed info
      modeLabel: "",     // "Random" or "Official 10:05"
      seedLabel: "",

      // Selection
      selecting: false,
      selectedPath: [],
      gestureMode: "idle", // idle | pending | tap | drag
      activePointerId: null,
      startX: 0,
      startY: 0,
      lastHoverKey: null,

      // UI
      foundWords: [],
      foundSet: new Set(),
      message: "",
      messageKind: "info",

      // Geometry for wrap line mask
      boardW: 1,
      boardH: 1,
      centres: new Map(),
      cutouts: [],
      pathPoints: [],

      // Mask tuning
      maskInset: 1,
      maskRx: 14,
      maskRy: 14,

      // Clock tick (for button label)
      now: new Date(),
      clockId: null
    };
  },

  computed: {
    currentWord() {
      const parts = this.selectedPath.map(p => this.grid[p.row][p.col]);
      return parts
        .map(s => (s === "Qu" || s === "QU") ? "QU" : String(s).toUpperCase())
        .join("");
    },

    score() {
      let total = 0;
      for (const w of this.foundWords) {
        total += this.scoreWord(w.length);
      }
      return total;
    },

    displayScore() {
    // Longest-word mode: show length of longest word found
    if (this.modeLabel && this.modeLabel.startsWith("Longest")) {
        const w = this.longestFoundWord();
        return w ? w.length : 0;
    }

    // Normal modes: show points
    return this.score;
    },

    polylinePointsAttr() {
      return this.pathPoints.map(p => `${p.x},${p.y}`).join(" ");
    },

    timeText() {
      const m = Math.floor(this.timeLeftSec / 60);
      const s = this.timeLeftSec % 60;
      return `${m}:${String(s).padStart(2, "0")}`;
    },

    statusText() {
      if (!this.dictReady) return "Loading dictionary…";
        // Always show the mode label if we have one (even after gameOver)
        return this.modeLabel ? this.modeLabel : "";
    },

    canInteract() {
      return this.dictReady && !this.gameOver;
    },

    currentSlotLabel() {
      const d = this.now;
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(Math.floor(d.getMinutes() / 5) * 5).padStart(2, "0");
      return `${hh}:${mm}`;
    }, 
    currentSlotLabel2() {
    const d = this.now;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(Math.floor(d.getMinutes() / 2) * 2).padStart(2, "0");
    return `${hh}:${mm}`;
    },
    missedCount() {
      return this.missedSolutions.length;
    },
    resultsText() {
    if (!this.gameOver) return "";

    const label = this.modeLabel ? this.modeLabel : "Game";

    // Longest-word mode
    if (label.startsWith("Longest")) {
        const w = this.longestFoundWord();
        if (!w) return `${label} · No valid word`;

        return `${label} · ${w} · ${w.length} letters`;
    }

    // Normal scoring mode
    const pts = this.score;
    const words = this.foundWords.length;
    return `${label} · ${pts} pts · ${words} words`;
    },
    longestSolutionWord() {
        if (!this.allSolutions || this.allSolutions.length === 0) return null;

        let best = this.allSolutions[0];
        for (const w of this.allSolutions) {
            if (w.length > best.length) best = w;
        }
        return best;
    },

    solutionsButtonText() {
        if (this.solving) return "Solving…";
        if (this.showSolutions) return "Hide solutions";

        // Longest-word mode
        if (this.modeLabel && this.modeLabel.startsWith("Longest")) {
            const w = this.longestSolutionWord;
            if (!w) return "Show solutions (no valid word)";
            return "Show solutions (" + w.length + " letters)";
        }

        // Normal modes
        return "Show solutions (" + this.missedSolutions.length + " missed)";
    }


  },

  async mounted() {
    this.rebuildGeometry();
    this.refreshPathLine();

    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);

    this.clockId = setInterval(() => {
      this.now = new Date();
    }, 1000);

    await this.loadDictionary();

    // Default: start with random (as you wanted)
    this.playRandom();

    setTimeout(() => {
      this.rebuildGeometry();
      this.refreshPathLine();
    }, 0);
  },

  unmounted() {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    this.stopTimer();
    if (this.clockId) clearInterval(this.clockId);
  },

  watch: {
    selectedPath: {
      deep: true,
      handler() {
        this.refreshPathLine();
      }
    }
  },

  methods: {
    // ---------- scoring ----------
    scoreWord(len) {
      if (len === 4) return 1;
      if (len === 5) return 2;
      if (len === 6) return 3;
      if (len === 7) return 5;
      if (len >= 8) return 11;
      return 0;
    },
    copyResults() {
    if (!this.resultsText) return;

    navigator.clipboard.writeText(this.resultsText).then(() => {
        this.showMessage("Results copied!", "good");
    }).catch(() => {
        this.showMessage("Could not copy results.", "bad");
    });
    },

    // ---------- dictionary + trie ----------
    async loadDictionary() {
      this.dictReady = false;
      this.dict = new Set();
      this.trieRoot = makeNode();

      try {
        const res = await fetch("words.txt", { cache: "no-cache" });
        if (!res.ok) throw new Error(`Failed to load words.txt (${res.status})`);
        const text = await res.text();

        const set = new Set();
        const root = makeNode();

        for (const line of text.split(/\r?\n/)) {
          const w = line.trim().toLowerCase();
          if (!w) continue;
          if (!/^[a-z]+$/.test(w)) continue;
          if (w.length < 4) continue; // minimum for this game
          set.add(w);
          trieInsert(root, w);
        }

        this.dict = set;
        this.trieRoot = root;
        this.dictReady = true;
      } catch (err) {
        console.warn(err);
        this.showMessage("Could not load words.txt. Check it’s in the same folder as index.html.", "bad");
      }
    },

    // ---------- seeded RNG ----------
    fnv1a32(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h >>> 0;
    },

    mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    // ---------- timer ----------
    startTimer() {
      this.stopTimer();
      this.timeLeftSec = this.gameLengthSec;
      this.gameOver = false;

      this.timerId = setInterval(() => {
        if (this.timeLeftSec <= 1) {
          this.timeLeftSec = 0;
          this.endGame();
          return;
        }
        this.timeLeftSec -= 1;
      }, 1000);
    },

    stopTimer() {
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    },

    async endGame() {
      this.stopTimer();
      this.gameOver = true;
      this.clearSelection();
      const label = this.modeLabel ? this.modeLabel : "Game";
      this.showMessage("Time’s up!", "info");


      // Run solver automatically at end
      await this.solveBoard();
      // don't show the solutions
      this.showSolutions = false;
    },

    // ---------- game selection ----------
    playOfficial() {
      if (!this.dictReady) return;

      this.gameLengthSec = this.gameLengthSecRegular;

      const d = new Date();
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mins5 = String(Math.floor(d.getUTCMinutes() / 5) * 5).padStart(2, "0");

      const slot = `${yyyy}-${mm}-${dd} ${hh}:${mins5}Z`;
      const seedString = `moggle|official|${slot}`;

      this.modeLabel = `Official ${this.currentSlotLabel}`;
      this.seedLabel = seedString;

      this.startNewBoardFromSeed(seedString);
    },

    playOfficialLongest() {
        if (!this.dictReady) return;

        // 1 minute round
        this.gameLengthSec = this.gameLengthSecLongest;

        // Seed changes every 2 minutes (UTC)
        const d = new Date();
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        const hh = String(d.getUTCHours()).padStart(2, "0");
        const mins2 = String(Math.floor(d.getUTCMinutes() / 2) * 2).padStart(2, "0");

        const slot = `${yyyy}-${mm}-${dd} ${hh}:${mins2}Z`;
        const seedString = `moggle|official-longest|${slot}`;

        this.modeLabel = `Longest ${this.currentSlotLabel2}`;
        this.seedLabel = seedString;

        this.startNewBoardFromSeed(seedString);
    },

    longestFoundWord() {
    if (this.foundWords.length === 0) return null;

    let best = this.foundWords[0];
    for (const w of this.foundWords) {
        if (w.length > best.length) best = w;
    }
    return best;
    },



    playRandom() {
      if (!this.dictReady) return;

      this.gameLengthSec = this.gameLengthSecRegular;

      let seedString = `moggle|random|${Date.now()}`;
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        const a = new Uint32Array(2);
        crypto.getRandomValues(a);
        seedString = `moggle|random|${a[0]}-${a[1]}-${Date.now()}`;
      }

      this.modeLabel = "Random";
      this.seedLabel = seedString;

      this.startNewBoardFromSeed(seedString);
    },

    startNewBoardFromSeed(seedString) {
      this.clearSelection();
      this.foundWords = [];
      this.foundSet = new Set();
      this.clearMessage();

      this.showSolutions = false;
      this.allSolutions = [];
      this.missedSolutions = [];

      const seed = this.fnv1a32(seedString);
      const rand = this.mulberry32(seed);

      if (!Array.isArray(DICE) || DICE.length !== 16) {
        this.showMessage("Paste your 16 dice into DICE in app.js.", "bad");
        return;
      }

      const idx = [...Array(16).keys()];
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }

      const rolled = idx.map(i => {
        const die = DICE[i];
        const face = die[Math.floor(rand() * die.length)];
        return (String(face).toLowerCase() === "qu") ? "Qu" : String(face).toUpperCase();
      });

      const g = [];
      for (let r = 0; r < 4; r++) {
        const row = [];
        for (let c = 0; c < 4; c++) row.push(rolled[r * 4 + c]);
        g.push(row);
      }
      this.grid = g;

      this.startTimer();

      this.$nextTick(() => {
        this.rebuildGeometry();
        this.refreshPathLine();
      });
    },

    // ---------- solver ----------
    async solveBoard() {
      if (!this.dictReady) return;
      if (this.solving) return;

      this.solving = true;

      // Let UI update (so “solving…” can render on slower devices)
      await new Promise(requestAnimationFrame);

      const root = this.trieRoot;

      // Precompute neighbours for 16 cells
      const neighbours = Array.from({ length: 16 }, () => []);
      const id = (r, c) => r * 4 + c;

      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const from = id(r, c);
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const rr = r + dr, cc = c + dc;
              if (rr >= 0 && rr < 4 && cc >= 0 && cc < 4) {
                neighbours[from].push(id(rr, cc));
              }
            }
          }
        }
      }

      // Flatten tiles and normalise to lowercase strings: 'a'..'z' or 'qu'
      const tiles = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const t = this.grid[r][c];
          tiles.push((t === "Qu" || t === "QU") ? "qu" : String(t).toLowerCase());
        }
      }

      const found = new Set();
      const visited = new Array(16).fill(false);

      const stepNode = (node, tileStr) => {
        // tileStr is 'qu' or 'a'...'z'
        if (tileStr === "qu") {
          const n1 = node.next["q"];
          if (!n1) return null;
          const n2 = n1.next["u"];
          if (!n2) return null;
          return n2;
        } else {
          return node.next[tileStr] || null;
        }
      };

      const appendStr = (word, tileStr) => word + (tileStr === "qu" ? "qu" : tileStr);

      const dfs = (pos, node, word) => {
        visited[pos] = true;

        if (node.end && word.length >= 4) {
          found.add(word);
        }

        for (const nb of neighbours[pos]) {
          if (visited[nb]) continue;

          const tileStr = tiles[nb];
          const nextNode = stepNode(node, tileStr);
          if (!nextNode) continue;

          dfs(nb, nextNode, appendStr(word, tileStr));
        }

        visited[pos] = false;
      };

      for (let start = 0; start < 16; start++) {
        const tileStr = tiles[start];
        const firstNode = stepNode(root, tileStr);
        if (!firstNode) continue;
        dfs(start, firstNode, appendStr("", tileStr));
      }

      // Sort by: score desc, length desc, alpha
      const list = Array.from(found);
      list.sort((a, b) => {
        const sa = this.scoreWord(a.length);
        const sb = this.scoreWord(b.length);
        if (sb !== sa) return sb - sa;
        if (b.length !== a.length) return b.length - a.length;
        return a.localeCompare(b);
      });

      const allUpper = list.map(w => w.toUpperCase());
      const foundByPlayer = new Set(this.foundWords.map(w => w.toLowerCase()));
      const missedUpper = list.filter(w => !foundByPlayer.has(w)).map(w => w.toUpperCase());

      this.allSolutions = allUpper;
      this.missedSolutions = missedUpper;

      this.solving = false;
    },

    // ---------- selection helpers ----------
    keyOf(r, c) { return `${r},${c}`; },

    isSelected(r, c) {
      return this.selectedPath.some(p => p.row === r && p.col === c);
    },

    indexInPath(r, c) {
      return this.selectedPath.findIndex(p => p.row === r && p.col === c);
    },

    lastCell() {
      return this.selectedPath.length ? this.selectedPath[this.selectedPath.length - 1] : null;
    },

    secondLastCell() {
      return this.selectedPath.length >= 2 ? this.selectedPath[this.selectedPath.length - 2] : null;
    },

    isAdjacent(r, c) {
      if (this.selectedPath.length === 0) return true;
      const last = this.lastCell();
      const dr = Math.abs(last.row - r);
      const dc = Math.abs(last.col - c);
      return dr <= 1 && dc <= 1;
    },

    addCell(r, c) {
      if (this.isSelected(r, c)) return;
      if (!this.isAdjacent(r, c)) return;
      this.selectedPath.push({ row: r, col: c });
    },

    rewindTo(r, c) {
      const idx = this.indexInPath(r, c);
      if (idx === -1) return;
      this.selectedPath = this.selectedPath.slice(0, idx + 1);
    },

    popLast() {
      if (this.selectedPath.length) this.selectedPath.pop();
    },

    clearSelection() {
      this.selecting = false;
      this.selectedPath = [];
      this.gestureMode = "idle";
      this.activePointerId = null;
      this.lastHoverKey = null;
      this.pathPoints = [];
    },

    showMessage(text, kind = "info") {
      this.message = text;
      this.messageKind = kind;
    },

    clearMessage() {
      this.message = "";
      this.messageKind = "info";
    },

    // ---------- geometry for wrap line mask ----------
    onResize() {
      this.rebuildGeometry();
      this.refreshPathLine();
    },

    rebuildGeometry() {
      const board = this.$refs.board;
      if (!board) return;

      this.boardW = board.clientWidth || 1;
      this.boardH = board.clientHeight || 1;

      const boardRect = board.getBoundingClientRect();
      const tiles = board.querySelectorAll("[data-row][data-col]");

      const centres = new Map();
      const cutouts = [];

      tiles.forEach(tile => {
        const r = Number(tile.dataset.row);
        const c = Number(tile.dataset.col);
        if (Number.isNaN(r) || Number.isNaN(c)) return;

        const rect = tile.getBoundingClientRect();
        const x = rect.left - boardRect.left;
        const y = rect.top - boardRect.top;
        const w = rect.width;
        const h = rect.height;

        centres.set(this.keyOf(r, c), { x: x + w / 2, y: y + h / 2 });

        const inset = this.maskInset;
        cutouts.push({
          x: x + inset,
          y: y + inset,
          w: Math.max(0, w - inset * 2),
          h: Math.max(0, h - inset * 2),
          rx: this.maskRx,
          ry: this.maskRy
        });
      });

      this.centres = centres;
      this.cutouts = cutouts;
    },

    refreshPathLine() {
      const pts = [];
      for (const cell of this.selectedPath) {
        const p = this.centres.get(this.keyOf(cell.row, cell.col));
        if (p) pts.push(p);
      }
      this.pathPoints = pts;
    },

    // ---------- hit-testing ----------
    cellFromPoint(clientX, clientY) {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el) return null;

      const tile = el.closest && el.closest("[data-row][data-col]");
      if (!tile) return null;

      const row = Number(tile.dataset.row);
      const col = Number(tile.dataset.col);
      if (Number.isNaN(row) || Number.isNaN(col)) return null;

      return { row, col };
    },

    // ---------- gestures ----------
    onTilePointerDown(e, row, col) {
      e.preventDefault();
      if (!this.canInteract) return;

      const isAlreadySelected = this.isSelected(row, col);
      const last = this.lastCell();
      const first = this.selectedPath.length ? this.selectedPath[0] : null;
      const isLast = last && last.row === row && last.col === col;
      const isFirst = first && first.row === row && first.col === col;

      if (this.selecting && this.gestureMode !== "drag") {
        this.gestureMode = "tap";
        this.clearMessage();

        if (isFirst) {
          this.clearSelection();
          return;
        }

        if (isLast) {
          this.submitWord();
          return;
        }

        if (isAlreadySelected) {
          this.rewindTo(row, col);
          return;
        }

        this.addCell(row, col);
      } else {
        this.selecting = true;
        this.gestureMode = "pending";
        this.clearMessage();
        this.selectedPath = [{ row, col }];
      }

      this.activePointerId = e.pointerId;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.lastHoverKey = this.keyOf(row, col);

      e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    },

    onBoardPointerMove(e) {
      if (!this.canInteract) return;
      if (!this.selecting) return;
      if (this.activePointerId !== e.pointerId) return;

      if (this.gestureMode === "pending") {
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        if (Math.hypot(dx, dy) >= 10) this.gestureMode = "drag";
      }

      if (this.gestureMode !== "drag") return;

      const cell = this.cellFromPoint(e.clientX, e.clientY);
      if (!cell) return;

      const k = this.keyOf(cell.row, cell.col);
      if (k === this.lastHoverKey) return;
      this.lastHoverKey = k;

      const secondLast = this.secondLastCell();
      if (secondLast && secondLast.row === cell.row && secondLast.col === cell.col) {
        this.popLast();
        return;
      }

      if (this.isSelected(cell.row, cell.col)) return;
      this.addCell(cell.row, cell.col);
    },

    onBoardPointerUp(e) {
      if (this.activePointerId !== e.pointerId) return;

      if (this.gestureMode === "pending") this.gestureMode = "tap";
      if (this.gestureMode === "drag") this.gestureMode = "tap";

      this.activePointerId = null;
      this.lastHoverKey = null;
    },

    onBoardPointerCancel() {
      this.clearSelection();
    },

    // ---------- submission ----------
    submitWord() {
      if (!this.canInteract) return;

      const wordUpper = this.currentWord;
      const word = wordUpper.toLowerCase();

      if (wordUpper.length < 4) {
        this.showMessage("Minimum 4 letters.", "bad");
        return;
      }

      if (this.foundSet.has(word)) {
        this.showMessage("Already found.", "bad");
        return;
      }

      if (!this.dict.has(word)) {
        this.showMessage("Not in dictionary.", "bad");
        return;
      }

      this.foundWords.unshift(wordUpper);
      this.foundSet.add(word);
      this.showMessage("Nice!", "good");
      this.clearSelection();
    }
  },

  template: `
    <main class="app">
      <header class="topbar">
        <div class="brand">
          <div class="title">Moggle</div>
          <div class="subtitle">
            Score: <span class="score">{{ displayScore }}</span>
            <span v-if="statusText" class="status"> · {{ statusText }}</span>
          </div>
        </div>

        <div class="timerbar">
          <div class="time">{{ timeText }}</div>
          <button class="btn mini" type="button" @click="playOfficial" :disabled="!dictReady">
            Official {{ currentSlotLabel }}
          </button>
          <button class="btn mini" type="button" @click="playRandom" :disabled="!dictReady">
            Play random
          </button>
          <button class="btn mini" type="button" @click="playOfficialLongest" :disabled="!dictReady">
            Longest {{ currentSlotLabel2 }}
          </button>
        </div>
      </header>

      <section class="game">
        <div
          class="board"
          ref="board"
          @pointermove="onBoardPointerMove"
          @pointerup="onBoardPointerUp"
          @pointercancel="onBoardPointerCancel"
          @pointerleave="onBoardPointerUp"
        >
          <svg
            class="path-underlay"
            aria-hidden="true"
            :viewBox="\`0 0 \${boardW} \${boardH}\`"
            preserveAspectRatio="none"
          >
            <defs>
              <mask id="tileCutoutMask">
                <rect x="0" y="0" :width="boardW" :height="boardH" fill="white" />
                <rect
                  v-for="(t, i) in cutouts"
                  :key="i"
                  :x="t.x"
                  :y="t.y"
                  :width="t.w"
                  :height="t.h"
                  :rx="t.rx"
                  :ry="t.ry"
                  fill="black"
                />
              </mask>
            </defs>

            <polyline
              v-if="pathPoints.length >= 2"
              class="path-line"
              :points="polylinePointsAttr"
              mask="url(#tileCutoutMask)"
            />
          </svg>

          <div class="tiles" :class="{ locked: gameOver }">
            <div class="row" v-for="(row, r) in grid" :key="r">
              <button
                class="tile"
                v-for="(letter, c) in row"
                :key="c"
                type="button"
                :class="{ selected: isSelected(r, c) }"
                :data-row="r"
                :data-col="c"
                @pointerdown="onTilePointerDown($event, r, c)"
              >
                <span class="letter">{{ letter }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="hud">
          <div class="current">
            <div class="current-label">Current</div>
            <div class="current-word">{{ currentWord || "—" }}</div>
          </div>

          <div class="actions">
            <button class="btn primary" type="button" @click="submitWord" :disabled="selectedPath.length === 0 || !canInteract">
              Enter
            </button>
            <button class="btn" type="button" @click="clearSelection" :disabled="selectedPath.length === 0 || !canInteract">
              Clear
            </button>
          </div>

          <div v-if="message" class="message" :class="messageKind">{{ message }}</div>

          <div class="microhint">
            Tap to select. Tap the first tile to clear. Tap the last tile to submit. Press and drag to draw a path.
          </div>
        </div>

        <div class="found">
          <div class="found-header">
            <div class="found-title">Found</div>
            <div class="found-count">{{ foundWords.length }}</div>
          </div>

          <div v-if="foundWords.length === 0" class="found-empty">No words yet.</div>

          <ul v-else class="found-list">
            <li v-for="w in foundWords" :key="w" class="found-item">{{ w }}</li>
          </ul>

          <div v-if="gameOver" style="margin-top: 12px;">
          <div v-if="gameOver" class="results">
            <div class="results-text">
                {{ resultsText }}
            </div>

            </div>

            <div v-if="gameOver" style="margin-top: 12px;">

            <button class="btn" type="button" @click="showSolutions = !showSolutions" :disabled="solving">
            {{ solutionsButtonText }}
            </button>



            <div v-if="showSolutions" style="margin-top: 10px;">
              <div style="font-weight: 900; margin-bottom: 6px;">
                Missed ({{ missedSolutions.length }})
              </div>
              <div v-if="missedSolutions.length === 0" class="found-empty">None — nice!</div>
              <ul v-else class="found-list">
                <li v-for="w in missedSolutions" :key="'m'+w" class="found-item">{{ w }}</li>
              </ul>

              <div style="font-weight: 900; margin: 12px 0 6px;">
                All solutions ({{ allSolutions.length }})
              </div>
              <ul class="found-list">
                <li v-for="w in allSolutions" :key="'a'+w" class="found-item">{{ w }}</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </main>
  `
}).mount("#app");
