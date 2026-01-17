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

      // Official slot + timer
      gameLengthSec: 180,
      timeLeftSec: 180,
      timerId: null,
      gameOver: false,

      // Mode / seed info (for display/debug)
      modeLabel: "",          // "Random" or "Official 10:05"
      seedLabel: "",          // seed string used

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

      // Mask tuning (your preferred)
      maskInset: 1,
      maskRx: 14,
      maskRy: 14,

      // Clock display tick
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
        const n = w.length;
        if (n === 4) total += 1;
        else if (n === 5) total += 2;
        else if (n === 6) total += 3;
        else if (n === 7) total += 5;
        else if (n >= 8) total += 11;
      }
      return total;
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
      if (this.gameOver) return "Time!";
      return this.modeLabel ? this.modeLabel : "";
    },

    canInteract() {
      return this.dictReady && !this.gameOver;
    },

    // Current 5-minute slot label, e.g. "10:05"
    currentSlotLabel() {
      const d = this.now;
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(Math.floor(d.getMinutes() / 5) * 5).padStart(2, "0");
      return `${hh}:${mm}`;
    }
  },

  async mounted() {
    this.rebuildGeometry();
    this.refreshPathLine();

    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);

    // Keep a lightweight clock tick so the button label updates
    this.clockId = setInterval(() => {
      this.now = new Date();
    }, 1000);

    await this.loadDictionary();

    // Default: start an official game immediately (nice family flow)
    // NOPE. 
    //this.playOfficial();
    // INSTEAD, I will play random and let everyone join at the same time. 
    this.playRandom();


    // Layout settle pass
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
    // ---------- dictionary ----------
    async loadDictionary() {
      this.dictReady = false;
      this.dict = new Set();

      try {
        const res = await fetch("words.txt", { cache: "no-cache" });
        if (!res.ok) throw new Error(`Failed to load words.txt (${res.status})`);
        const text = await res.text();

        const set = new Set();
        for (const line of text.split(/\r?\n/)) {
          const w = line.trim().toLowerCase();
          if (!w) continue;
          if (!/^[a-z]+$/.test(w)) continue;
          set.add(w);
        }

        this.dict = set;
        this.dictReady = true;
      } catch (err) {
        console.warn(err);
        this.showMessage("Could not load words.txt. Check it’s in the same folder as index.html.", "bad");
      }
    },

    // ---------- seeded RNG (deterministic across devices) ----------
    // 32-bit FNV-1a hash -> integer seed
    fnv1a32(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        // h *= 16777619 (with overflow)
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h >>> 0;
    },

    // Mulberry32 PRNG
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

    endGame() {
      this.stopTimer();
      this.gameOver = true;
      this.clearSelection();
      this.showMessage(`Time’s up! Final score: ${this.score}`, "info");
    },

    // ---------- game selection (official vs random) ----------
    playOfficial() {
      if (!this.dictReady) return;

      // Use UTC in the seed so everyone worldwide is consistent if needed.
      // If you want "local time for family only", swap to local fields.
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

    playRandom() {
      if (!this.dictReady) return;

      // Random seed based on crypto if available, else Date
      let seedString = `moggle|random|${Date.now()}`;
      if (crypto && crypto.getRandomValues) {
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

      // Build deterministic RNG
      const seed = this.fnv1a32(seedString);
      const rand = this.mulberry32(seed);

      // Need 16 dice
      if (!Array.isArray(DICE) || DICE.length !== 16) {
        this.showMessage("Paste your 16 dice into DICE in app.js.", "bad");
        return;
      }

      // Deterministic shuffle of dice indices
      const idx = [...Array(16).keys()];
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }

      // Deterministic face selection
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

      // Start the 3-minute countdown for this game
      this.startTimer();

      this.$nextTick(() => {
        this.rebuildGeometry();
        this.refreshPathLine();
      });
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

    // ---------- submission / validation ----------
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
            Score: <span class="score">{{ score }}</span>
            <span v-if="statusText" class="status"> · {{ statusText }}</span>
          </div>
        </div>

        <div class="timerbar">
          <div class="time">{{ timeText }}</div>
          <button class="btn mini" type="button" @click="playOfficial" :disabled="!dictReady">
            Play {{ currentSlotLabel }}
          </button>
          <button class="btn mini" type="button" @click="playRandom" :disabled="!dictReady">
            Play random
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
        </div>
      </section>
    </main>
  `
}).mount("#app");
