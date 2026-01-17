const { createApp } = Vue;

createApp({
  data() {
    return {
      grid: [
        ["T", "A", "P", "E"],
        ["R", "S", "L", "N"],
        ["O", "I", "D", "M"],
        ["C", "H", "U", "G"]
      ],

      // Selection
      selecting: false,
      selectedPath: [],          // [{row, col}]
      gestureMode: "idle",       // idle | pending | tap | drag
      activePointerId: null,
      startX: 0,
      startY: 0,
      lastHoverKey: null,

      // UI
      foundWords: [],
      message: "",
      messageKind: "info",

      // Geometry for SVG
      boardW: 1,
      boardH: 1,
      centres: new Map(),        // "r,c" -> {x,y}
      cutouts: [],               // [{x,y,w,h,rx,ry}] (tile rects for mask)
      pathPoints: []             // [{x,y}] (centres along selection)
    };
  },

  computed: {
    currentWord() {
      return this.selectedPath.map(p => this.grid[p.row][p.col]).join("");
    },
    score() {
      return this.foundWords.length;
    },
    polylinePointsAttr() {
      return this.pathPoints.map(p => `${p.x},${p.y}`).join(" ");
    }
  },

  mounted() {
    this.rebuildGeometry();
    this.refreshPathLine();

    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);

    // Let layout settle
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
    // ---------- helpers ----------
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

    // ---------- geometry for line + mask ----------
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

        centres.set(this.keyOf(r, c), {
          x: x + w / 2,
          y: y + h / 2
        });

        // Mask cutout slightly INSET so the line peeks through gaps nicely.
        // Also matches tile rounding visually.
        const inset = 1;         // adjust if you want more/less wrap
        const rx = 14;           // should match CSS tile radius closely
        const ry = 14;

        cutouts.push({
          x: x + inset,
          y: y + inset,
          w: Math.max(0, w - inset * 2),
          h: Math.max(0, h - inset * 2),
          rx,
          ry
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

    // ---------- hit-testing for drag ----------
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

  const isAlreadySelected = this.isSelected(row, col);
  const last = this.lastCell();
  const first = this.selectedPath.length ? this.selectedPath[0] : null;
  const isLast =
    last && last.row === row && last.col === col;
  const isFirst =
    first && first.row === row && first.col === col;

  // If we are already selecting (tap mode), interpret special taps:
  if (this.selecting && this.gestureMode !== "drag") {
    this.gestureMode = "tap";
    this.clearMessage();

    // Tap first tile -> clear everything
    if (isFirst) {
      this.clearSelection();
      return;
    }

    // Tap last tile again -> submit
    if (isLast) {
      this.submitWord();
      return;
    }

    // Tap any other selected tile -> rewind back to it
    if (isAlreadySelected) {
      this.rewindTo(row, col);
      return;
    }

    // Otherwise extend path
    this.addCell(row, col);
  } else {
    // Start a fresh selection
    this.selecting = true;
    this.gestureMode = "pending";
    this.clearMessage();
    this.selectedPath = [{ row, col }];
  }

  // Track pointer for drag detection (if they move, it becomes drag mode)
  this.activePointerId = e.pointerId;
  this.startX = e.clientX;
  this.startY = e.clientY;
  this.lastHoverKey = this.keyOf(row, col);

  e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
},

    onBoardPointerMove(e) {
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

    // ---------- submit ----------
    submitWord() {
      const word = this.currentWord;

      if (word.length < 4) {
        this.showMessage("Minimum 4 letters.", "bad");
        return;
      }

      const upper = word.toUpperCase();
      if (this.foundWords.includes(upper)) {
        this.showMessage("Already found.", "bad");
        return;
      }

      this.foundWords.unshift(upper);
      this.showMessage("Added!", "good");
      this.clearSelection();
    }
  },

  template: `
    <main class="app">
      <header class="topbar">
        <div class="brand">
          <div class="title">Moggle</div>
          <div class="subtitle">Score: <span class="score">{{ score }}</span></div>
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
          <!-- Underlay: draw line in full, then CUT OUT tile interiors so it only shows in gaps -->
          <svg
            class="path-underlay"
            aria-hidden="true"
            :viewBox="\`0 0 \${boardW} \${boardH}\`"
            preserveAspectRatio="none"
          >
            <defs>
              <mask id="tileCutoutMask">
                <!-- keep everything -->
                <rect x="0" y="0" :width="boardW" :height="boardH" fill="white" />
                <!-- remove tile interiors -->
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
          </div>

          <div v-if="message" class="message" :class="messageKind">{{ message }}</div>

          <div class="microhint">
            Tap to select. Tap a selected tile to backtrack. Press and drag to draw a path.
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
