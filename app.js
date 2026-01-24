const { createApp } = Vue;

/**
 * Paste your 16 dice here.
 * 16 items, each an array of faces (strings). Use "Qu" for Qu.
 */
const DICE = [
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

// ---- Weird: 5-variant rotating mode ----

// a) Hard mode: reverse-ish frequency bag
const WEIRD_RULES_REVERSED = [
  "Z","Z","Z","X","X","J","J","K","K","Qu","Qu",
  "B","B","C","C","D","D","F","F","G","G",
  "E","A","O","T","I","N","S","H","R","L"
];

// Frequency-ish bag (no Q tile; "Qu" instead).
// Used for ABC (A–M) and XYZ (N–Z).
const WEIRD_FREQ_BAG = [
  // E (12)
  "E","E","E","E","E","E","E","E","E","E","E","E",
  // T (9)
  "T","T","T","T","T","T","T","T","T",
  // A (9)
  "A","A","A","A","A","A","A","A","A",
  // O (8)
  "O","O","O","O","O","O","O","O",
  // I (8)
  "I","I","I","I","I","I","I","I",
  // N (6)
  "N","N","N","N","N","N",
  // S (6)
  "S","S","S","S","S","S",
  // H (6)
  "H","H","H","H","H","H",
  // R (6)
  "R","R","R","R","R","R",
  // D (4)
  "D","D","D","D",
  // L (4)
  "L","L","L","L",
  // C (3)
  "C","C","C",
  // U (3)
  "U","U","U",
  // M (2)
  "M","M",
  // W (2)
  "W","W",
  // F (2)
  "F","F",
  // G (2)
  "G","G",
  // Y (2)
  "Y","Y",
  // P (2)
  "P","P",
  // singles
  "B","V","K","J","X","Qu","Z"
];

// b) Voweltacular config: which single vowel all vowels become
const VOWELTACULAR_VOWEL = "A";

// d) Vowel-less config
const VOWELLESS_VOWELS = ["A", "E", "I", "O", "U"]; // vowels used for the two forced tiles

// Helper: normalise tile text for board
function normTile(face) {
  return (String(face).toLowerCase() === "qu") ? "Qu" : String(face).toUpperCase();
}

function isVowelTile(tile) {
  const t = String(tile).toUpperCase();
  return t === "A" || t === "E" || t === "I" || t === "O" || t === "U";
}

function inRangeAZ(letter, start, end) {
  const ch = String(letter).toUpperCase();
  if (ch === "QU") return false;
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  return code >= start.charCodeAt(0) && code <= end.charCodeAt(0);
}

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
        ["P", "I", "C", "K"],
        ["G", "A", "M", "E"],
        ["M", "O", "D", "E"],
        ["—", "—", "—", "—"]
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
      gameLengthSec: 180,
      gameLengthSecRegular: 180,
      gameLengthSecLongest: 60,
      timeLeftSec: 0,
      timerId: null,
      gameOver: true,
      messageTimer: null,
      messageVisible: false,

      // Mode / seed info
      modeLabel: "Pick game mode",
      seedLabel: "",

      // Which mode is currently active (for saving)
      modeType: "", // "daily" | "official" | "longest" | "weird"

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

      helpOpen: false,

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
      for (const w of this.foundWords) total += this.scoreWord(w.length);
      return total;
    },

    displayScore() {
      if (this.modeLabel && this.modeLabel.startsWith("Longest")) {
        const w = this.longestFoundWord();
        return w ? w.length : 0;
      }
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

    dailyLabel() {
      const d = this.now;
      const dd = String(d.getDate()).padStart(2, "0");
      const mons = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const mon = mons[d.getMonth()];
      return `${dd}-${mon}`;
    },

    missedCount() {
      return this.missedSolutions.length;
    },

    resultsText() {
      if (!this.gameOver) return "";

      const label = this.modeLabel ? this.modeLabel : "Game";

      if (label.startsWith("Longest")) {
        const w = this.longestFoundWord();
        if (!w) return `${label} · No valid word`;
        return `${label} · ${w} · ${w.length} letters`;
      }

      const pts = this.score;
      const words = this.foundWords.length;
      return `${label} · ${pts} pts · ${words} words`;
    },

    longestSolutionWord() {
      if (!this.allSolutions || this.allSolutions.length === 0) return null;
      let best = this.allSolutions[0];
      for (const w of this.allSolutions) if (w.length > best.length) best = w;
      return best;
    },

    foundLengthRanks() {
      const lengths = new Set();
      for (const w of this.foundWords) lengths.add(String(w).length);
      const sorted = Array.from(lengths).sort((a, b) => b - a);
      const maxLen = sorted[0] ?? 0;
      const secondLen = sorted.find(n => n < maxLen) ?? 0;
      return { maxLen, secondLen };
    },

    solutionsButtonText() {
      if (this.solving) return "Solving…";
      if (this.showSolutions) return "Hide solutions";

      if (this.modeLabel && this.modeLabel.startsWith("Longest")) {
        const w = this.longestSolutionWord;
        if (!w) return "Show solutions (no valid word)";
        return "Show solutions (" + w.length + " letters)";
      }

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

    this.pruneFinishedSaves();

    // Do not start a game on load; show placeholder.
    this.showPickModeBoard();

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
      handler() { this.refreshPathLine(); }
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

    // ---------- placeholder ----------
    showPickModeBoard() {
      this.grid = [
        ["P", "I", "C", "K"],
        ["G", "A", "M", "E"],
        ["M", "O", "D", "E"],
        ["—", "—", "—", "—"]
      ];

      this.modeType = "";
      this.modeLabel = "Pick game mode";
      this.seedLabel = "";

      this.stopTimer();
      this.gameOver = true;
      this.timeLeftSec = 0;

      this.clearSelection();
      this.clearMessage();

      this.foundWords = [];
      this.foundSet = new Set();
      this.showSolutions = false;
      this.allSolutions = [];
      this.missedSolutions = [];
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
          if (w.length < 4) continue;
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

    // ---------- localStorage: finished game saving ----------
    finishedPrefix() { return "moggle:finished:"; },

    saveKey(modeType, slot) {
      return `${this.finishedPrefix()}${modeType}:${encodeURIComponent(slot)}`;
    },

    parseSeed(seedString) {
      // seedString formats:
      //   moggle|daily|YYYY-MM-DD
      //   moggle|official|YYYY-MM-DD HH:MMZ
      //   moggle|official-longest|YYYY-MM-DD HH:MMZ
      //   moggle|weird|<variantId>|YYYY-MM-DD HH:MMZ
      const parts = String(seedString).split("|");
      if (parts.length < 3) return null;
      const kind = parts[1];
      const slot = parts.slice(2).join("|");
      return { kind, slot };
    },

    slotForDailyLocal() {
      const d = new Date();
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    },

    loadFinished(modeType, slot) {
      try {
        const raw = localStorage.getItem(this.saveKey(modeType, slot));
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !data.seedString || !Array.isArray(data.foundWords) || !data.finishedAt) return null;
        return data;
      } catch {
        return null;
      }
    },

    saveFinishedCurrentGame() {
      if (!this.gameOver) return;
      if (!this.seedLabel) return;
      if (!this.modeType) return;

      const parsed = this.parseSeed(this.seedLabel);
      if (!parsed) return;

      const payload = {
        v: 1,
        modeType: this.modeType,
        slot: parsed.slot,
        seedString: this.seedLabel,
        foundWords: this.foundWords,
        finishedAt: Date.now()
      };

      try {
        localStorage.setItem(this.saveKey(this.modeType, parsed.slot), JSON.stringify(payload));
      } catch (e) {
        console.warn("Could not save finished game:", e);
      }

      this.pruneFinishedSaves();
    },

    pruneFinishedSaves() {
      const MAX_TOTAL = 400;

      const now = Date.now();
      const msHour = 3600000;
      const msDay = 86400000;

      const maxAgeByMode = {
        daily: 30 * msDay,
        official: 48 * msHour,
        longest: 48 * msHour,
        weird: 48 * msHour
      };

      const prefix = this.finishedPrefix();
      const items = [];

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(prefix)) continue;

        let data = null;
        try {
          data = JSON.parse(localStorage.getItem(k));
        } catch {
          items.push({ key: k, finishedAt: 0, modeType: "unknown", corrupted: true });
          continue;
        }

        const finishedAt = Number(data?.finishedAt || 0);
        const modeType = String(data?.modeType || "");
        items.push({ key: k, finishedAt, modeType, corrupted: false });
      }

      for (const it of items) {
        if (it.corrupted) {
          try { localStorage.removeItem(it.key); } catch {}
          continue;
        }

        const maxAge = maxAgeByMode[it.modeType];
        if (!maxAge) {
          try { localStorage.removeItem(it.key); } catch {}
          continue;
        }

        if (!it.finishedAt || (now - it.finishedAt) > maxAge) {
          try { localStorage.removeItem(it.key); } catch {}
        }
      }

      const kept = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        try {
          const data = JSON.parse(localStorage.getItem(k));
          kept.push({ key: k, finishedAt: Number(data?.finishedAt || 0) });
        } catch {
          try { localStorage.removeItem(k); } catch {}
        }
      }

      kept.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
      if (kept.length > MAX_TOTAL) {
        for (let i = MAX_TOTAL; i < kept.length; i++) {
          try { localStorage.removeItem(kept[i].key); } catch {}
        }
      }
    },

    async loadFinishedIntoUI(modeType, seedString) {
      const parsed = this.parseSeed(seedString);
      if (!parsed) return false;

      const saved = this.loadFinished(modeType, parsed.slot);
      if (!saved) return false;
      if (saved.seedString !== seedString) return false;

      this.clearSelection();
      this.clearMessage();

      this.showSolutions = false;
      this.allSolutions = [];
      this.missedSolutions = [];

      this.startNewBoardFromSeed(seedString);

      this.stopTimer();
      this.gameOver = true;
      this.timeLeftSec = 0;

      this.foundWords = saved.foundWords.slice();
      this.foundSet = new Set(this.foundWords.map(w => String(w).toLowerCase()));

      await this.solveBoard();
      this.showSolutions = false;

      return true;
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
      this.showMessage("Time’s up!", "info");

      await this.solveBoard();
      this.showSolutions = false;

      this.saveFinishedCurrentGame();
    },

    // ------------- help section handling ------------
    openHelp() {
      this.helpOpen = true;

      this.$nextTick(() => {
        const pop = this.$refs.helpPop;
        if (pop && pop.scrollIntoView) {
          pop.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });

      document.addEventListener("pointerdown", this.onOutsideHelp, { once: true });
    },

    closeHelp() { this.helpOpen = false; },

    onOutsideHelp(e) {
      const helpEl = this.$refs.help;
      if (helpEl && helpEl.contains(e.target)) {
        document.addEventListener("pointerdown", this.onOutsideHelp, { once: true });
        return;
      }
      this.closeHelp();
    },

    // ---------- Weird variants (extensible) ----------
    weirdVariants() {
      // Add more variants by appending objects here. Keep ids short + stable.
      return [
        { id: "hard", name: "Hard", build: this.weirdBuildHard },
        { id: "vowel", name: "Voweltacular", build: this.weirdBuildVoweltacular },
        { id: "abc", name: "ABC", build: this.weirdBuildABC },
        { id: "vless", name: "Low vowels", build: this.weirdBuildVowelless },
        { id: "xyz", name: "N to Z", build: this.weirdBuildXYZ }
      ];
    },

    weirdVariantForSlotUTC(yyyy, mm, dd, hh, mins5) {
      const variants = this.weirdVariants();
      // Deterministic global rotation: advance every 5 minutes (UTC), modulo number of variants.
      // We compute a simple index from a monotonically increasing "slot number".
      const dayNum = Math.floor(Date.UTC(yyyy, mm - 1, dd) / 86400000);
      const slotInDay = (Number(hh) * 12) + Math.floor(Number(mins5) / 5); // 12 slots per hour
      const slotNum = dayNum * (24 * 12) + slotInDay;

      const idx = ((slotNum % variants.length) + variants.length) % variants.length;
      return variants[idx];
    },

    parseWeirdSlot(slotStr) {
      // slotStr format: "<variantId>|YYYY-MM-DD HH:MMZ"
      const parts = String(slotStr).split("|");
      if (parts.length < 2) return null;
      const variantId = parts[0];
      const timeSlot = parts.slice(1).join("|");
      return { variantId, timeSlot };
    },

    // ---------- game selection ----------
    async playDaily() {
      if (!this.dictReady) return;

      this.modeType = "daily";
      this.gameLengthSec = this.gameLengthSecRegular;

      const slot = this.slotForDailyLocal();
      const seedString = `moggle|daily|${slot}`;

      this.modeLabel = `Daily ${this.dailyLabel}`;
      this.seedLabel = seedString;

      const loaded = await this.loadFinishedIntoUI("daily", seedString);
      if (loaded) {
        this.showMessage("Already completed.", "info", 1200);
        return;
      }

      this.startNewBoardFromSeed(seedString);
    },

    async playOfficial() {
      if (!this.dictReady) return;

      this.modeType = "official";
      this.gameLengthSec = this.gameLengthSecRegular;

      const d = new Date();
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mins5 = String(Math.floor(d.getUTCMinutes() / 5) * 5).padStart(2, "0");

      const slot = `${yyyy}-${mm}-${dd} ${hh}:${mins5}Z`;
      const seedString = `moggle|official|${slot}`;

      this.modeLabel = `5-min ${this.currentSlotLabel}`;
      this.seedLabel = seedString;

      const loaded = await this.loadFinishedIntoUI("official", seedString);
      if (loaded) {
        this.showMessage("Already completed.", "info", 1200);
        return;
      }

      this.startNewBoardFromSeed(seedString);
    },

    async playOfficialLongest() {
      if (!this.dictReady) return;

      this.modeType = "longest";
      this.gameLengthSec = this.gameLengthSecLongest;

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

      const loaded = await this.loadFinishedIntoUI("longest", seedString);
      if (loaded) {
        this.showMessage("Already completed.", "info", 1200);
        return;
      }

      this.startNewBoardFromSeed(seedString);
    },

    async playWeird() {
      if (!this.dictReady) return;

      this.modeType = "weird";
      this.gameLengthSec = this.gameLengthSecRegular;

      const d = new Date();
      const yyyyN = d.getUTCFullYear();
      const mmN = d.getUTCMonth() + 1;
      const ddN = d.getUTCDate();
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mins5 = String(Math.floor(d.getUTCMinutes() / 5) * 5).padStart(2, "0");

      const variant = this.weirdVariantForSlotUTC(yyyyN, mmN, ddN, hh, mins5);

      const slotTime = `${yyyyN}-${String(mmN).padStart(2, "0")}-${String(ddN).padStart(2, "0")} ${hh}:${mins5}Z`;
      const seedString = `moggle|weird|${variant.id}|${slotTime}`;

      // Show variant name in the label
      this.modeLabel = `Weird (${variant.name}) ${this.currentSlotLabel}`;
      this.seedLabel = seedString;

      const loaded = await this.loadFinishedIntoUI("weird", seedString);
      if (loaded) {
        this.showMessage("Already completed.", "info", 1200);
        return;
      }

      this.startNewBoardFromSeed(seedString);
    },

    longestFoundWord() {
      if (this.foundWords.length === 0) return null;
      let best = this.foundWords[0];
      for (const w of this.foundWords) if (w.length > best.length) best = w;
      return best;
    },

    foundWordClass(wordUpper) {
      if (!this.gameOver) return "";
      const len = String(wordUpper).length;
      if (len <= 4) return "";

      const { maxLen, secondLen } = this.foundLengthRanks;
      if (len === maxLen && maxLen > 4) return "found-best";
      if (len === secondLen && secondLen > 4) return "found-second";
      return "";
    },

    // ---------- board generation core ----------
    rollNormalDice(rand) {
      if (!Array.isArray(DICE) || DICE.length !== 16) return null;

      const idx = [...Array(16).keys()];
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }

      return idx.map(i => {
        const die = DICE[i];
        const face = die[Math.floor(rand() * die.length)];
        return normTile(face);
      });
    },

    pickFromBag(rand, bag) {
      const face = bag[Math.floor(rand() * bag.length)];
      return normTile(face);
    },

    rolledToGrid(rolled16) {
      const g = [];
      for (let r = 0; r < 4; r++) {
        const row = [];
        for (let c = 0; c < 4; c++) row.push(rolled16[r * 4 + c]);
        g.push(row);
      }
      return g;
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

      const parsed = this.parseSeed(seedString);
      const kind = parsed?.kind || "";

      let rolled = null;

      if (kind === "weird") {
        // Determine which weird variant from the seed slot
        const slotInfo = this.parseWeirdSlot(parsed.slot);
        const variantId = slotInfo?.variantId || "hard";

        const variants = this.weirdVariants();
        const variant = variants.find(v => v.id === variantId) || variants[0];

        rolled = variant.build.call(this, rand);
      } else {
        // Normal rolling for daily/official/longest
        rolled = this.rollNormalDice(rand);
      }

      if (!rolled || rolled.length !== 16) {
        this.showMessage("Could not generate board.", "bad");
        return;
      }

      this.grid = this.rolledToGrid(rolled);

      this.startTimer();

      this.$nextTick(() => {
        this.rebuildGeometry();
        this.refreshPathLine();
      });
    },

    // ---------- Weird variant builders ----------
    // a) Hard: pick tiles from WEIRD_RULES_REVERSED uniformly
    weirdBuildHard(rand) {
      const rolled = [];
      for (let i = 0; i < 16; i++) rolled.push(this.pickFromBag(rand, WEIRD_RULES_REVERSED));
      return rolled;
    },

    // b) Voweltacular: normal dice, then all vowels -> single vowel (default A)
    weirdBuildVoweltacular(rand) {
      const VOWELS = new Set(["A","E","I","O","U"]);

      // Build boosted frequency bag
      const boostedBag = [];

      for (const ch of WEIRD_FREQ_BAG) {
        boostedBag.push(ch); // always include original

        // Add extra copy for vowels (1.5× total ≈ add one extra every second vowel). Changed to <0.6
        const t = String(ch).toUpperCase();
        if (VOWELS.has(t) && rand() < 0.6) {
          boostedBag.push(ch);
        }
      }

      // Roll 16 tiles from the boosted bag
      const rolled = [];
      for (let i = 0; i < 16; i++) {
        const face = boostedBag[Math.floor(rand() * boostedBag.length)];
        rolled.push(face === "Qu" ? "Qu" : String(face).toUpperCase());
      }

      return rolled;
    },


    // c) ABC: A–M using frequency bag
    weirdBuildABC(rand) {
      const WEIRD_BAG_A_TO_M = [
        // Vowels (kept deliberately modest)
        "A","A",
        "E","E",
        "I","I",

        // Core consonants
        "B","C","D","D",
        "F","G","H","H",
        "J","K","L","L",
        "M","M",

      ];
      const bag = WEIRD_BAG_A_TO_M;
      const rolled = [];
      for (let i = 0; i < 16; i++) rolled.push(this.pickFromBag(rand, bag));
      return rolled;
    },

    // d) Vowel-less: no vowels except exactly two, forced into middle four tiles
    weirdBuildVowelless(rand) {
      // Build 16 consonant-only tiles from frequency bag (excluding vowels + "Qu")
      const consonantBag = WEIRD_FREQ_BAG.filter(ch => {
        const t = String(ch).toUpperCase();
        if (t === "QU") return false;
        if (t.length !== 1) return false;
        if (t === "A" || t === "E" || t === "I" || t === "O" || t === "U") return false;
        return t >= "A" && t <= "Z";
      });

      const rolled = [];
      for (let i = 0; i < 16; i++) rolled.push(this.pickFromBag(rand, consonantBag));

      // Middle 4 indices in a 4x4 grid: (1,1)(1,2)(2,1)(2,2) => 5,6,9,10
      const middle = [5, 6, 9, 10];

      // Pick 2 distinct middle positions
      const picks = middle.slice();
      for (let i = picks.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [picks[i], picks[j]] = [picks[j], picks[i]];
      }
      const pos1 = picks[0];
      const pos2 = picks[1];

      // Pick 2 vowels (allowing duplicates is fine; set distinct if you prefer)
      const v1 = VOWELLESS_VOWELS[Math.floor(rand() * VOWELLESS_VOWELS.length)];
      const v2 = VOWELLESS_VOWELS[Math.floor(rand() * VOWELLESS_VOWELS.length)];

      rolled[pos1] = String(v1).toUpperCase();
      rolled[pos2] = String(v2).toUpperCase();

      return rolled;
    },

    // e) XYZ: N–Z using frequency bag
    weirdBuildXYZ(rand) {
      const WEIRD_BAG_N_TO_Z = [
        // Vowels (boosted slightly)
        "O","O",
        "U","U",

        // Core glue consonants
        "N","N",
        "R","R",
        "S","S",
        "T","T",

        // Added structure
        "W", "P",

        // Semi-vowel / spice
        "Y",

        // Rare letter
        "Z",

        // Wildcard
        "Qu"
      ];
      const bag = WEIRD_BAG_N_TO_Z;
      const rolled = [];
      for (let i = 0; i < 16; i++) rolled.push(this.pickFromBag(rand, bag));
      return rolled;

    },

    // ---------- UI helpers ----------
    isFoundSolution(wordUpper) {
      return this.foundSet.has(String(wordUpper).toLowerCase());
    },

    // ---------- solver ----------
    async solveBoard() {
      if (!this.dictReady) return;
      if (this.solving) return;

      this.solving = true;
      await new Promise(requestAnimationFrame);

      const root = this.trieRoot;

      const neighbours = Array.from({ length: 16 }, () => []);
      const id = (r, c) => r * 4 + c;

      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const from = id(r, c);
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const rr = r + dr, cc = c + dc;
              if (rr >= 0 && rr < 4 && cc >= 0 && cc < 4) neighbours[from].push(id(rr, cc));
            }
          }
        }
      }

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
        if (tileStr === "qu") {
          const n1 = node.next["q"];
          if (!n1) return null;
          const n2 = n1.next["u"];
          if (!n2) return null;
          return n2;
        }
        return node.next[tileStr] || null;
      };

      const appendStr = (word, tileStr) => word + (tileStr === "qu" ? "qu" : tileStr);

      const dfs = (pos, node, word) => {
        visited[pos] = true;

        if (node.end && word.length >= 4) found.add(word);

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

    showMessage(text, kind = "info", autoClearMs = null) {
      this.message = text;
      this.messageKind = kind;
      this.messageVisible = true;

      if (this.messageTimer) {
        clearTimeout(this.messageTimer);
        this.messageTimer = null;
      }

      if (autoClearMs) {
        this.messageTimer = setTimeout(() => {
          this.messageVisible = false;
          this.messageTimer = null;
        }, autoClearMs);
      }
    },

    clearMessage() {
      if (this.messageTimer) {
        clearTimeout(this.messageTimer);
        this.messageTimer = null;
      }
      this.messageVisible = false;
    },

    pickSuccessMessage(len) {
      const short = ["Nice!", "Good one!", "Yep!", "Solid!", "Found it!"];
      const mid = ["Good find!", "Great!", "Wow!", "Strong!", "Nice spot!"];
      const long = ["Excellent!", "Brilliant!", "Huge!", "Great word!", "Love it!"];

      const pool = (len >= 8) ? long : (len >= 6 ? mid : short);
      return pool[Math.floor(Math.random() * pool.length)];
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

      this.showMessage(this.pickSuccessMessage(wordUpper.length), "good", 1100);

      this.clearSelection();
    }
  },

  template: `
    <main class="app">
      <header class="topbar">
        <div class="brand">
          <div class="title">Moggle</div>
          <div class="time time--top">{{ timeText }}</div>
          <div class="subtitle">
            <span v-if="statusText" class="status"> {{ statusText }} · </span>
            Score: <span class="score">{{ displayScore }}</span>
            <button
              v-if="gameOver && modeType"
              class="copybtn"
              type="button"
              @click="copyResults"
              aria-label="Copy results"
              title="Copy results"
            >
              ⧉
            </button>
          </div>
        </div>

        <div class="timerbar">
          <button class="btn mini" type="button" @click="playDaily" :disabled="!dictReady">
            <span class="btn-mode">Daily</span>
            <span class="btn-meta">{{ dailyLabel }}</span>
          </button>

          <button class="btn mini" type="button" @click="playOfficial" :disabled="!dictReady">
            <span class="btn-mode">5-min</span>
            <span class="btn-meta">{{ currentSlotLabel }}</span>
          </button>

          <button class="btn mini" type="button" @click="playOfficialLongest" :disabled="!dictReady">
            <span class="btn-mode">Longest</span>
            <span class="btn-meta">{{ currentSlotLabel2 }}</span>
          </button>

          <button class="btn mini" type="button" @click="playWeird" :disabled="!dictReady">
            <span class="btn-mode">Weird</span>
            <span class="btn-meta">{{ currentSlotLabel }}</span>
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
              <mask
                id="tileCutoutMask"
                maskUnits="userSpaceOnUse"
                maskContentUnits="userSpaceOnUse"
                x="0"
                y="0"
                :width="boardW"
                :height="boardH"
              >
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

          <div class="hud-bottom">
            <div class="message compact" :class="[messageKind, { show: messageVisible }]">
              {{ message || "\u00A0" }}
            </div>

            <div class="help" ref="help">
              <button
                class="help-btn"
                type="button"
                @click="helpOpen ? closeHelp() : openHelp()"
                aria-label="Help"
                title="Help"
              >
                {{ helpOpen ? "×" : "?" }}
              </button>

              <div v-if="helpOpen" class="help-pop" ref="helpPop">
                <div class="help-title">How to play</div>
                <div class="help-text">
                  Tap to select. Tap the first tile to clear. Tap the last tile to submit.
                  Press and drag to draw a path.
                </div>

                <div class="help-title" style="margin-top: 10px;">Modes</div>
                <ul class="help-list">
                  <li><b>Daily</b> — same board all day.</li>
                  <li><b>5-min</b> — board changes every 5 minutes.</li>
                  <li><b>Longest</b> — 1 minute; score is longest word length. Board changes every 2 minutes.</li>
                  <li><b>Weird</b> — rotates through special variants every 5 minutes (shown in the mode name).</li>
                </ul>

                <div class="help-text">
                  Tap the <span class="help-icon">⧉</span> button next to your score after the game ends to copy your results and share them.
                </div>
              </div>
            </div>
          </div>
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
            <li
              v-for="w in foundWords"
              :key="w"
              class="found-item"
              :class="foundWordClass(w)"
            >
              {{ w }}
            </li>
          </ul>

          <div v-if="gameOver && modeType" style="margin-top: 12px;">
            <button
              class="btn"
              type="button"
              @click="showSolutions = !showSolutions"
              :disabled="solving"
            >
              {{ solutionsButtonText }}
            </button>

            <div v-if="showSolutions" style="margin-top: 10px;">
              <div style="font-weight: 900; margin-bottom: 6px;">
                All solutions ({{ allSolutions.length }})
              </div>

              <div v-if="allSolutions.length === 0" class="found-empty">
                No valid words on this board.
              </div>

              <ul v-else class="found-list">
                <li
                  v-for="w in allSolutions"
                  :key="'a'+w"
                  class="found-item solution"
                  :class="isFoundSolution(w) ? 'found' : 'missed'"
                >
                  {{ w }}
                </li>
              </ul>
            </div>
          </div>
        </div>

      </section>
    </main>
  `
}).mount("#app");
