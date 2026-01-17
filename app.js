const { createApp } = Vue;

/**
 * Paste your 16 dice here.
 * Format: 16 items, each item is an array of faces (strings).
 * Use "Qu" (capital Q, lower u) for Qu faces if you want it displayed nicely.
 *
 * Example die: ["A", "A", "E", "E", "G", "N"]
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
  ["H", "I", "M", "N", "Qu", "U"], // example with Qu
  ["E", "E", "I", "N", "S", "U"],
  ["E", "E", "G", "H", "N", "W"],
  ["A", "F", "F", "K", "P", "S"],
  ["H", "L", "N", "N", "R", "Z"],
  ["D", "E", "I", "L", "R", "X"]
];

createApp({
  data() {
    return {
      // Board (strings, e.g. "A", "Qu")
      grid: [
        ["T", "A", "P", "E"],
        ["R", "S", "L", "N"],
        ["O", "I", "D", "M"],
        ["C", "H", "U", "G"]
      ],

      // Dictionary
      dictReady: false,
      dict: new Set(), // lowercase words

      // Selection
      selecting: false,
      selectedPath: [],          // [{row, col}]
      gestureMode: "idle",       // idle | pending | tap | drag
      activePointerId: null,
      startX: 0,
      startY: 0,
      lastHoverKey: null,

      // UI
      foundWords: [],            // display strings (UPPERCASE)
      foundSet: new Set(),       // lowercase, for fast duplicate check
      message: "",
      messageKind: "info",

      // Geometry for wrap-style line mask
      boardW: 1,
      boardH: 1,
      centres: new Map(),        // "r,c" -> {x,y}
      cutouts: [],               // [{x,y,w,h,rx,ry}]
      pathPoints: [],            // [{x,y}]

      // Mask tuning (match what you liked)
      maskInset: 1,              // you said 1 looked great
      maskRx: 14,                // keep close to CSS tile radius
      maskRy: 14
    };
  },

  computed: {
    // Word as it should be checked/scored, e.g. "QUICK" (no spaces)
    currentWord() {
      const parts = this.selectedPath.map(p => this.grid[p.row][p.col]);
      // "Qu" tile contributes QU; other letters just uppercase
      return parts.map(s => (s === "Qu" || s === "QU") ? "QU" : String(s).toUpperCase()).join("");
    },
    score() {
      // Classic Boggle scoring
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
    statusText() {
      return this.dictReady ? "" : "Loading dictionary…";
    }
  },

  async mounted() {
    this.rebuildGeometry();
    this.refreshPathLine();

    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);

    // Load dictionary, then roll a fresh board
    await this.loadDictionary();
    this.newGame();

    // Layout settle pass
    setTimeout(() => {
      this.rebuildGeometry();
      this.refreshPathLine();
    }, 0);
  },

  unmounted() {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
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

        // One word per line (case-insensitive)
        const set = new Set();
        for (const line of text.split(/\r?\n/)) {
          const w = line.trim().toLowerCase();
          if (!w) continue;
          // Basic sanitation: only keep a–z (and allow 'qu' naturally)
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

    // ---------- board generation ----------
    newGame() {
      this.clearSelection();
      this.foundWords = [];
      this.foundSet = new Set();
      this.clearMessage();

      // If you haven’t pasted dice yet, keep the current grid.
      if (!Array.isArray(DICE) || DICE.length !== 16) {
        this.showMessage("Paste your 16 dice into DICE in app.js to enable random boards.", "info");
        return;
      }

      const diceOrder = this.shuffle([...Array(16).keys()]);
      const rolled = diceOrder.map(i => {
        const die = DICE[i];
        const face = die[Math.floor(Math.random() * die.length)];
        // normalise Qu display
        return (String(face).toLowerCase() === "qu") ? "Qu" : String(face).toUpperCase();
      });

      // Fill 4x4
      const g = [];
      for (let r = 0; r < 4; r++) {
        const row = [];
        for (let c = 0; c < 4; c++) {
          row.push(rolled[r * 4 + c]);
        }
        g.push(row);
      }
      this.grid = g;

      // Geometry depends on tile positions; update after DOM paints
      this.$nextTick(() => {
        this.rebuildGeometry();
        this.refreshPathLine();
      });
    },

    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
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

    // ---------- gestures (tap vs drag, with special taps) ----------
    onTilePointerDown(e, row, col) {
      e.preventDefault();

      const isAlreadySelected = this.isSelected(row, col);
      const last = this.lastCell();
      const first = this.selectedPath.length ? this.selectedPath[0] : null;
      const isLast = last && last.row === row && last.col === col;
      const isFirst = first && first.row === row && first.col === col;

      if (this.selecting && this.gestureMode !== "drag") {
        this.gestureMode = "tap";
        this.clearMessage();

        // Tap first tile -> clear
        if (isFirst) {
          this.clearSelection();
          return;
        }

        // Tap last tile again -> submit
        if (isLast) {
          this.submitWord();
          return;
        }

        // Tap other selected tile -> rewind
        if (isAlreadySelected) {
          this.rewindTo(row, col);
          return;
        }

        // Otherwise extend
        this.addCell(row, col);
      } else {
        // Start fresh selection
        this.selecting = true;
        this.gestureMode = "pending";
        this.clearMessage();
        this.selectedPath = [{ row, col }];
      }

      // Track pointer for drag detection
      this.activePointerId = e.pointerId;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.lastHoverKey = this.keyOf(row, col);

      e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    },

    onBoardPointerMove(e) {
      if (!this.selecting) return;
      if (this.activePointerId !== e.pointerId) return;

      // Decide drag vs tap once movement exceeds threshold
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

      // Drag backtrack: move onto second-last tile to pop last
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
      if (!this.dictReady) {
        this.showMessage("Dictionary still loading…", "info");
        return;
      }

      const wordUpper = this.currentWord;
      const word = wordUpper.toLowerCase();

      if (wordUpper.length < 4) {
        this.showMessage("Minimum 4 letters.", "bad");
        return;
      }

      // Optional extra rule: disallow words containing 'q' not followed by 'u'
      // (Usually unnecessary if you rely on Qu tiles, but it’s a nice sanity check.)
      if (word.includes("q") && !word.includes("qu")) {
        this.showMessage("Invalid Q (must be QU).", "bad");
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

          <div class="tiles">
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
            <button class="btn primary" type="button" @click="submitWord" :disabled="selectedPath.length === 0">
              Enter
            </button>
            <button class="btn" type="button" @click="clearSelection" :disabled="selectedPath.length === 0">
              Clear
            </button>
            <button class="btn" type="button" @click="newGame">
              New
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
