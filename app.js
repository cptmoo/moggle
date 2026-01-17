const { createApp } = Vue;

createApp({
  data() {
    return {
      // Replace later with random generation if you want
      grid: [
        ["T", "A", "P", "E"],
        ["R", "S", "L", "N"],
        ["O", "I", "D", "M"],
        ["C", "H", "U", "G"]
      ],

      // Selection state
      selecting: false,
      selectedPath: [], // [{row, col}]
      gestureMode: "idle", // idle | pending | tap | drag

      // Pointer tracking
      activePointerId: null,
      startX: 0,
      startY: 0,
      lastHoverKey: null,

      // UI state
      foundWords: [],
      message: "",
      messageKind: "info" // info | good | bad
    };
  },

  computed: {
    currentWord() {
      return this.selectedPath.map(p => this.grid[p.row][p.col]).join("");
    },
    score() {
      // Placeholder scoring: 1 point per accepted word
      return this.foundWords.length;
    }
  },

  methods: {
    // ---------- Helpers ----------
    keyOf(row, col) {
      return `${row},${col}`;
    },

    isSelected(row, col) {
      return this.selectedPath.some(p => p.row === row && p.col === col);
    },

    lastCell() {
      return this.selectedPath.length ? this.selectedPath[this.selectedPath.length - 1] : null;
    },

    isAdjacent(row, col) {
      if (this.selectedPath.length === 0) return true;
      const last = this.lastCell();
      const dr = Math.abs(last.row - row);
      const dc = Math.abs(last.col - col);
      return dr <= 1 && dc <= 1;
    },

    showMessage(text, kind = "info") {
      this.message = text;
      this.messageKind = kind;
    },

    clearMessage() {
      this.message = "";
      this.messageKind = "info";
    },

    clearSelection() {
      this.selecting = false;
      this.selectedPath = [];
      this.gestureMode = "idle";
      this.activePointerId = null;
      this.lastHoverKey = null;
    },

    addCell(row, col) {
      if (this.isSelected(row, col)) return;
      if (!this.isAdjacent(row, col)) return;

      this.selectedPath.push({ row, col });
    },

    // ---------- Board hit-testing (for drag hover) ----------
    cellFromPoint(clientX, clientY) {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el) return null;
      const tile = el.closest?.("[data-row][data-col]");
      if (!tile) return null;

      const row = Number(tile.dataset.row);
      const col = Number(tile.dataset.col);
      if (Number.isNaN(row) || Number.isNaN(col)) return null;

      return { row, col };
    },

    // ---------- Gesture handling ----------
    onTilePointerDown(e, row, col) {
      // Start / continue selection in "pending" mode.
      // Whether it becomes tap or drag depends on movement.
      e.preventDefault();

      // If we're already selecting (tap mode), a new press acts like a tap-add.
      // Strands-like feel: you can tap multiple tiles in sequence.
      if (this.selecting && this.gestureMode !== "drag") {
        this.gestureMode = "tap";
        this.clearMessage();
        this.addCell(row, col);
      } else {
        // Start fresh selection
        this.selecting = true;
        this.gestureMode = "pending";
        this.clearMessage();
        this.selectedPath = [{ row, col }];
      }

      this.activePointerId = e.pointerId;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.lastHoverKey = this.keyOf(row, col);

      // Capture pointer so we keep getting moves/up even if finger leaves the tile
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },

    onBoardPointerMove(e) {
      if (!this.selecting) return;
      if (this.activePointerId !== e.pointerId) return;

      // Decide drag vs tap once movement exceeds threshold
      if (this.gestureMode === "pending") {
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        const dist = Math.hypot(dx, dy);

        if (dist >= 10) {
          this.gestureMode = "drag";
        }
      }

      if (this.gestureMode !== "drag") return;

      const cell = this.cellFromPoint(e.clientX, e.clientY);
      if (!cell) return;

      const k = this.keyOf(cell.row, cell.col);
      if (k === this.lastHoverKey) return;

      this.lastHoverKey = k;
      this.addCell(cell.row, cell.col);
    },

    onBoardPointerUp(e) {
      if (this.activePointerId !== e.pointerId) return;

      // If it never became drag, treat it as tap flow.
      // We keep selection active so they can continue tapping.
      if (this.gestureMode === "pending") {
        this.gestureMode = "tap";
      }

      if (this.gestureMode === "drag") {
        // End the drag gesture, but keep the selection
        // (like Strands, you can drag-build then hit Enter)
        this.gestureMode = "tap";
      }

      this.activePointerId = null;
      this.lastHoverKey = null;
    },

    onBoardPointerCancel() {
      // If the OS cancels touch (incoming call, app switch, etc.)
      this.clearSelection();
    },

    // ---------- Submission ----------
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

      // Placeholder acceptance (dictionary later)
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
          @pointermove="onBoardPointerMove"
          @pointerup="onBoardPointerUp"
          @pointercancel="onBoardPointerCancel"
          @pointerleave="onBoardPointerUp"
        >
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
        </div>

        <div class="found">
          <div class="found-header">
            <div class="found-title">Found</div>
            <div class="found-count">{{ foundWords.length }}</div>
          </div>

          <div v-if="foundWords.length === 0" class="found-empty">
            No words yet.
          </div>

          <ul v-else class="found-list">
            <li v-for="w in foundWords" :key="w" class="found-item">{{ w }}</li>
          </ul>
        </div>
      </section>
    </main>
  `
}).mount("#app");
