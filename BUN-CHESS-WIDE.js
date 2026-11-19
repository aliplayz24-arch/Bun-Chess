
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// ============================================================================
// 1. SHARED CHESS ENGINE + AI (Used by Bun server AND served to Browser UI)
// ============================================================================
function createChessEngine() {
  const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

  const INITIAL_BOARD = [
    "r", "n", "b", "q", "k", "b", "n", "r",
    "p", "p", "p", "p", "p", "p", "p", "p",
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, null,
    "P", "P", "P", "P", "P", "P", "P", "P",
    "R", "N", "B", "Q", "K", "B", "N", "R",
  ];

  function pieceColor(p) {
    if (!p) return null;
    return p === p.toUpperCase() ? "w" : "b";
  }

  function oppositeColor(color) {
    return color === "w" ? "b" : "w";
  }

  function squareToAlg(sq) {
    return FILES[sq & 7] + (8 - (sq >> 3));
  }

  function algToSquare(alg) {
    if (!alg || alg.length !== 2) return -1;
    const c = FILES.indexOf(alg[0]);
    const r = 8 - parseInt(alg[1], 10);
    if (c < 0 || r < 0 || r > 7 || Number.isNaN(r)) return -1;
    return r * 8 + c;
  }

  function getEffectiveEp(board, turn, ep) {
    if (ep === null) return "-";
    const r = ep >> 3;
    const c = ep & 7;
    const pawnRow = turn === "w" ? r + 1 : r - 1;
    const myPawn = turn === "w" ? "P" : "p";
    if (c > 0 && board[pawnRow * 8 + (c - 1)] === myPawn) return String(ep);
    if (c < 7 && board[pawnRow * 8 + (c + 1)] === myPawn) return String(ep);
    return "-";
  }

  function getPositionKey(state) {
    let b = "";
    for (let i = 0; i < 64; i++) b += state.board[i] || ".";
    const c =
      (state.castling.K ? "K" : "") +
      (state.castling.Q ? "Q" : "") +
      (state.castling.k ? "k" : "") +
      (state.castling.q ? "q" : "");
    return `${b}|${state.turn}|${c || "-"}|${getEffectiveEp(state.board, state.turn, state.ep)}`;
  }

  function stateToFen(state) {
    const ranks = [];
    for (let r = 0; r < 8; r++) {
      let rowStr = "";
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = state.board[r * 8 + c];
        if (!p) {
          empty++;
        } else {
          if (empty > 0) {
            rowStr += String(empty);
            empty = 0;
          }
          rowStr += p;
        }
      }
      if (empty > 0) rowStr += String(empty);
      ranks.push(rowStr);
    }
    const castling =
      (state.castling.K ? "K" : "") +
      (state.castling.Q ? "Q" : "") +
      (state.castling.k ? "k" : "") +
      (state.castling.q ? "q" : "");
    const ep = state.ep !== null ? squareToAlg(state.ep) : "-";
    return `${ranks.join("/")} ${state.turn} ${castling || "-"} ${ep} ${state.halfmove} ${state.fullmove}`;
  }

  function fenToState(fen) {
    if (typeof fen !== "string") return null;
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) return null;
    const [placement, turn, castlingStr, epStr, halfStr, fullStr] = parts;
    const ranks = placement.split("/");
    if (ranks.length !== 8) return null;

    const board = new Array(64).fill(null);
    const validPieces = "PNBRQKpnbrqk";
    let wk = 0;
    let bk = 0;

    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of ranks[r]) {
        if (ch >= "1" && ch <= "8") {
          c += parseInt(ch, 10);
        } else if (validPieces.includes(ch)) {
          if (c >= 8) return null;
          if ((r === 0 || r === 7) && (ch === "P" || ch === "p")) return null;
          if (ch === "K") wk++;
          if (ch === "k") bk++;
          board[r * 8 + c] = ch;
          c++;
        } else {
          return null;
        }
      }
      if (c !== 8) return null;
    }

    if (wk !== 1 || bk !== 1) return null;
    if (turn !== "w" && turn !== "b") return null;

    const castling = {
      K: castlingStr.includes("K") && board[60] === "K" && board[63] === "R",
      Q: castlingStr.includes("Q") && board[60] === "K" && board[56] === "R",
      k: castlingStr.includes("k") && board[4] === "k" && board[7] === "r",
      q: castlingStr.includes("q") && board[4] === "k" && board[0] === "r",
    };

    let ep = null;
    if (epStr !== "-") {
      ep = algToSquare(epStr);
      if (ep === -1) return null;
    }

    const halfmove = halfStr ? Math.max(0, parseInt(halfStr, 10) || 0) : 0;
    const fullmove = fullStr ? Math.max(1, parseInt(fullStr, 10) || 1) : 1;

    const state = {
      board,
      turn,
      castling,
      ep,
      halfmove,
      fullmove,
      initialFen: null,
      history: [],
      positionCounts: {},
    };
    state.initialFen = stateToFen(state);
    state.positionCounts[getPositionKey(state)] = 1;
    return state;
  }

  function createInitialState(customFen = null) {
    if (customFen && customFen.trim()) {
      const parsed = fenToState(customFen);
      if (parsed) return parsed;
    }
    const state = {
      board: INITIAL_BOARD.slice(),
      turn: "w",
      castling: { K: true, Q: true, k: true, q: true },
      ep: null,
      halfmove: 0,
      fullmove: 1,
      initialFen: null,
      history: [],
      positionCounts: {},
    };
    state.initialFen = stateToFen(state);
    state.positionCounts[getPositionKey(state)] = 1;
    return state;
  }

  function cloneState(state, includeHistory = true) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      castling: { ...state.castling },
      ep: state.ep,
      halfmove: state.halfmove,
      fullmove: state.fullmove,
      initialFen: state.initialFen,
      history: includeHistory ? state.history.map((h) => ({ ...h })) : [],
      positionCounts: includeHistory ? { ...state.positionCounts } : {},
    };
  }

  function findKing(board, color) {
    const k = color === "w" ? "K" : "k";
    for (let i = 0; i < 64; i++) {
      if (board[i] === k) return i;
    }
    return -1;
  }

  const KNIGHT_OFFSETS = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];
  const KING_OFFSETS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];
  const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function isSquareAttacked(board, sq, byColor) {
    const r = sq >> 3;
    const c = sq & 7;

    const pawn = byColor === "w" ? "P" : "p";
    const pawnSourceRow = byColor === "w" ? r + 1 : r - 1;
    if (pawnSourceRow >= 0 && pawnSourceRow < 8) {
      if (c > 0 && board[pawnSourceRow * 8 + (c - 1)] === pawn) return true;
      if (c < 7 && board[pawnSourceRow * 8 + (c + 1)] === pawn) return true;
    }

    const knight = byColor === "w" ? "N" : "n";
    for (let i = 0; i < 8; i++) {
      const nr = r + KNIGHT_OFFSETS[i][0];
      const nc = c + KNIGHT_OFFSETS[i][1];
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr * 8 + nc] === knight) {
        return true;
      }
    }

    const king = byColor === "w" ? "K" : "k";
    for (let i = 0; i < 8; i++) {
      const kr = r + KING_OFFSETS[i][0];
      const kc = c + KING_OFFSETS[i][1];
      if (kr >= 0 && kr < 8 && kc >= 0 && kc < 8 && board[kr * 8 + kc] === king) {
        return true;
      }
    }

    const bishop = byColor === "w" ? "B" : "b";
    const queen = byColor === "w" ? "Q" : "q";
    for (let d = 0; d < 4; d++) {
      const dr = BISHOP_DIRS[d][0];
      const dc = BISHOP_DIRS[d][1];
      let nr = r + dr;
      let nc = c + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr * 8 + nc];
        if (p) {
          if (p === bishop || p === queen) return true;
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    const rook = byColor === "w" ? "R" : "r";
    for (let d = 0; d < 4; d++) {
      const dr = ROOK_DIRS[d][0];
      const dc = ROOK_DIRS[d][1];
      let nr = r + dr;
      let nc = c + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr * 8 + nc];
        if (p) {
          if (p === rook || p === queen) return true;
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    return false;
  }

  function isInCheck(state, color = state.turn) {
    const kSq = findKing(state.board, color);
    if (kSq === -1) return false;
    return isSquareAttacked(state.board, kSq, oppositeColor(color));
  }

  function generatePseudoMoves(state) {
    const { board, turn, castling, ep } = state;
    const moves = [];
    const isWhite = turn === "w";
    const opp = isWhite ? "b" : "w";

    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p || pieceColor(p) !== turn) continue;

      const r = sq >> 3;
      const c = sq & 7;
      const type = p.toLowerCase();

      if (type === "p") {
        const dir = isWhite ? -1 : 1;
        const startRow = isWhite ? 6 : 1;
        const promoRow = isWhite ? 0 : 7;
        const nr = r + dir;

        if (nr >= 0 && nr < 8) {
          const oneStep = nr * 8 + c;
          if (!board[oneStep]) {
            if (nr === promoRow) {
              for (const promo of ["q", "r", "b", "n"]) {
                moves.push({ from: sq, to: oneStep, promotion: promo });
              }
            } else {
              moves.push({ from: sq, to: oneStep });
              if (r === startRow) {
                const twoStep = (r + dir * 2) * 8 + c;
                if (!board[twoStep]) {
                  moves.push({ from: sq, to: twoStep, doublePush: true });
                }
              }
            }
          }

          for (const dc of [-1, 1]) {
            const nc = c + dc;
            if (nc < 0 || nc > 7) continue;
            const targetSq = nr * 8 + nc;
            const targetPiece = board[targetSq];
            if (targetPiece && pieceColor(targetPiece) === opp) {
              if (nr === promoRow) {
                for (const promo of ["q", "r", "b", "n"]) {
                  moves.push({ from: sq, to: targetSq, promotion: promo, capture: targetPiece });
                }
              } else {
                moves.push({ from: sq, to: targetSq, capture: targetPiece });
              }
            } else if (ep !== null && targetSq === ep) {
              const epVictim = board[r * 8 + nc];
              if (epVictim && pieceColor(epVictim) === opp && epVictim.toLowerCase() === "p") {
                moves.push({ from: sq, to: targetSq, enPassant: true, capture: epVictim });
              }
            }
          }
        }
      } else if (type === "n") {
        for (let i = 0; i < 8; i++) {
          const nr = r + KNIGHT_OFFSETS[i][0];
          const nc = c + KNIGHT_OFFSETS[i][1];
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
          const targetSq = nr * 8 + nc;
          const target = board[targetSq];
          if (!target) moves.push({ from: sq, to: targetSq });
          else if (pieceColor(target) === opp) moves.push({ from: sq, to: targetSq, capture: target });
        }
      } else if (type === "b" || type === "r" || type === "q") {
        const dirs =
          type === "b"
            ? BISHOP_DIRS
            : type === "r"
            ? ROOK_DIRS
            : BISHOP_DIRS.concat(ROOK_DIRS);
        for (let d = 0; d < dirs.length; d++) {
          const dr = dirs[d][0];
          const dc = dirs[d][1];
          let nr = r + dr;
          let nc = c + dc;
          while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const targetSq = nr * 8 + nc;
            const target = board[targetSq];
            if (!target) {
              moves.push({ from: sq, to: targetSq });
            } else {
              if (pieceColor(target) === opp) moves.push({ from: sq, to: targetSq, capture: target });
              break;
            }
            nr += dr;
            nc += dc;
          }
        }
      } else if (type === "k") {
        for (let i = 0; i < 8; i++) {
          const nr = r + KING_OFFSETS[i][0];
          const nc = c + KING_OFFSETS[i][1];
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
          const targetSq = nr * 8 + nc;
          const target = board[targetSq];
          if (!target) moves.push({ from: sq, to: targetSq });
          else if (pieceColor(target) === opp) moves.push({ from: sq, to: targetSq, capture: target });
        }

        if (isWhite && sq === 60) {
          if (
            castling.K &&
            board[61] === null &&
            board[62] === null &&
            board[63] === "R" &&
            !isSquareAttacked(board, 60, "b") &&
            !isSquareAttacked(board, 61, "b") &&
            !isSquareAttacked(board, 62, "b")
          ) {
            moves.push({ from: 60, to: 62, castle: "K" });
          }
          if (
            castling.Q &&
            board[59] === null &&
            board[58] === null &&
            board[57] === null &&
            board[56] === "R" &&
            !isSquareAttacked(board, 60, "b") &&
            !isSquareAttacked(board, 59, "b") &&
            !isSquareAttacked(board, 58, "b")
          ) {
            moves.push({ from: 60, to: 58, castle: "Q" });
          }
        } else if (!isWhite && sq === 4) {
          if (
            castling.k &&
            board[5] === null &&
            board[6] === null &&
            board[7] === "r" &&
            !isSquareAttacked(board, 4, "w") &&
            !isSquareAttacked(board, 5, "w") &&
            !isSquareAttacked(board, 6, "w")
          ) {
            moves.push({ from: 4, to: 6, castle: "k" });
          }
          if (
            castling.q &&
            board[3] === null &&
            board[2] === null &&
            board[1] === null &&
            board[0] === "r" &&
            !isSquareAttacked(board, 4, "w") &&
            !isSquareAttacked(board, 3, "w") &&
            !isSquareAttacked(board, 2, "w")
          ) {
            moves.push({ from: 4, to: 2, castle: "q" });
          }
        }
      }
    }

    return moves;
  }

  function applyRawMove(state, move) {
    const next = cloneState(state, false);
    const { board, turn } = next;
    const piece = board[move.from];
    const isWhite = turn === "w";

    board[move.from] = null;

    if (move.enPassant) {
      const capRow = move.from >> 3;
      const capCol = move.to & 7;
      board[capRow * 8 + capCol] = null;
    }

    if (move.promotion) {
      board[move.to] = isWhite ? move.promotion.toUpperCase() : move.promotion.toLowerCase();
    } else {
      board[move.to] = piece;
    }

    if (move.castle === "K") {
      board[63] = null;
      board[61] = "R";
    } else if (move.castle === "Q") {
      board[56] = null;
      board[59] = "R";
    } else if (move.castle === "k") {
      board[7] = null;
      board[5] = "r";
    } else if (move.castle === "q") {
      board[0] = null;
      board[3] = "r";
    }

    if (piece === "K") {
      next.castling.K = false;
      next.castling.Q = false;
    } else if (piece === "k") {
      next.castling.k = false;
      next.castling.q = false;
    }
    if (move.from === 63 || move.to === 63) next.castling.K = false;
    if (move.from === 56 || move.to === 56) next.castling.Q = false;
    if (move.from === 7 || move.to === 7) next.castling.k = false;
    if (move.from === 0 || move.to === 0) next.castling.q = false;

    next.ep = move.doublePush ? (move.from + move.to) >> 1 : null;
    next.halfmove = piece.toLowerCase() === "p" || move.capture ? 0 : state.halfmove + 1;
    if (!isWhite) next.fullmove = state.fullmove + 1;
    next.turn = oppositeColor(turn);
    return next;
  }

  function generateLegalMoves(state) {
    const pseudo = generatePseudoMoves(state);
    const legal = [];
    const movingColor = state.turn;
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i];
      const next = applyRawMove(state, m);
      if (!isInCheck(next, movingColor)) legal.push(m);
    }
    return legal;
  }

  function checkSuffix(san, nextState) {
    if (!isInCheck(nextState, nextState.turn)) return san;
    const oppMoves = generateLegalMoves(nextState);
    return san + (oppMoves.length === 0 ? "#" : "+");
  }

  function buildSAN(state, move, legalMoves, nextState) {
    if (move.castle === "K" || move.castle === "k") return checkSuffix("O-O", nextState);
    if (move.castle === "Q" || move.castle === "q") return checkSuffix("O-O-O", nextState);

    const piece = state.board[move.from];
    const type = piece.toLowerCase();
    const dest = squareToAlg(move.to);
    let san = "";

    if (type === "p") {
      if (move.capture) san += FILES[move.from & 7] + "x";
      san += dest;
      if (move.promotion) san += "=" + move.promotion.toUpperCase();
    } else {
      san += type.toUpperCase();
      const conflicts = legalMoves.filter(
        (m) => m.to === move.to && m.from !== move.from && state.board[m.from] === piece
      );
      if (conflicts.length > 0) {
        const sameFile = conflicts.some((m) => (m.from & 7) === (move.from & 7));
        const sameRank = conflicts.some((m) => (m.from >> 3) === (move.from >> 3));
        if (!sameFile) san += FILES[move.from & 7];
        else if (!sameRank) san += String(8 - (move.from >> 3));
        else san += squareToAlg(move.from);
      }
      if (move.capture) san += "x";
      san += dest;
    }

    return checkSuffix(san, nextState);
  }

  function makeMove(state, moveInput) {
    const legalMoves = generateLegalMoves(state);
    const promo = moveInput.promotion ? moveInput.promotion.toLowerCase() : undefined;
    const move = legalMoves.find(
      (m) =>
        m.from === moveInput.from &&
        m.to === moveInput.to &&
        (m.promotion || undefined) === promo
    );
    if (!move) return null;

    const next = applyRawMove(state, move);
    const san = buildSAN(state, move, legalMoves, next);
    const fen = stateToFen(next);

    next.history = state.history.map((h) => ({ ...h }));
    next.history.push({
      from: move.from,
      to: move.to,
      piece: state.board[move.from],
      capture: move.capture || null,
      promotion: move.promotion || null,
      castle: move.castle || null,
      enPassant: !!move.enPassant,
      san,
      color: state.turn,
      fen,
      inCheck: isInCheck(next, next.turn),
    });

    next.positionCounts = { ...state.positionCounts };
    const key = getPositionKey(next);
    next.positionCounts[key] = (next.positionCounts[key] || 0) + 1;

    return { state: next, move: next.history[next.history.length - 1] };
  }

  function isInsufficientMaterial(board) {
    const minors = [];
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      const t = p.toLowerCase();
      if (t === "k") continue;
      if (t === "p" || t === "r" || t === "q") return false;
      minors.push({ p, sq: i, color: pieceColor(p), type: t });
      if (minors.length > 2) return false;
    }
    if (minors.length <= 1) return true;
    if (
      minors.length === 2 &&
      minors[0].type === "b" &&
      minors[1].type === "b" &&
      minors[0].color !== minors[1].color
    ) {
      const c1 = ((minors[0].sq >> 3) + (minors[0].sq & 7)) & 1;
      const c2 = ((minors[1].sq >> 3) + (minors[1].sq & 7)) & 1;
      return c1 === c2;
    }
    return false;
  }

  function getGameStatus(state) {
    const legalMoves = generateLegalMoves(state);
    const inCheck = isInCheck(state, state.turn);

    if (legalMoves.length === 0) {
      if (inCheck) {
        return { over: true, result: "checkmate", winner: oppositeColor(state.turn), inCheck: true };
      }
      return { over: true, result: "stalemate", winner: "draw", inCheck: false };
    }
    if (state.halfmove >= 100) {
      return { over: true, result: "fifty-move", winner: "draw", inCheck };
    }
    const key = getPositionKey(state);
    if ((state.positionCounts[key] || 0) >= 3) {
      return { over: true, result: "threefold", winner: "draw", inCheck };
    }
    if (isInsufficientMaterial(state.board)) {
      return { over: true, result: "insufficient", winner: "draw", inCheck };
    }
    return { over: false, result: null, winner: null, inCheck };
  }

  function getCapturedAndMaterial(state, historySlice = state.history) {
    const capturedByWhite = [];
    const capturedByBlack = [];
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let whiteMat = 0;
    let blackMat = 0;

    for (const h of historySlice) {
      if (h.capture) {
        if (h.color === "w") capturedByWhite.push(h.capture);
        else capturedByBlack.push(h.capture);
      }
    }

    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (!p) continue;
      const v = values[p.toLowerCase()];
      if (pieceColor(p) === "w") whiteMat += v;
      else blackMat += v;
    }

    const sortOrder = { q: 0, r: 1, b: 2, n: 3, p: 4 };
    const cmp = (a, b) => sortOrder[a.toLowerCase()] - sortOrder[b.toLowerCase()];
    capturedByWhite.sort(cmp);
    capturedByBlack.sort(cmp);

    return { capturedByWhite, capturedByBlack, advantage: whiteMat - blackMat };
  }

  const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  const PST_PAWN = [
    0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5,  5, 10, 25, 25, 10,  5,  5,
    0,  0,  0, 20, 20,  0,  0,  0,
    5, -5,-10,  0,  0,-10, -5,  5,
    5, 10, 10,-20,-20, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0,
  ];
  const PST_KNIGHT = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ];
  const PST_BISHOP = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ];
  const PST_ROOK = [
    0,  0,  0,  0,  0,  0,  0,  0,
    5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    0,  0,  0,  5,  5,  0,  0,  0,
  ];
  const PST_QUEEN = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ];
  const PST_KING_MID = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20,
  ];
  const PST_KING_END = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50,
  ];

  function evaluate(state) {
    const { board, turn } = state;
    let score = 0;
    let nonKingMat = 0;

    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      const t = p.toLowerCase();
      if (t !== "k") nonKingMat += PIECE_VALUES[t];
    }
    const isEndgame = nonKingMat <= 2400;

    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      const isWhite = p === p.toUpperCase();
      const t = p.toLowerCase();
      const pstSq = isWhite ? i : i ^ 56;
      let val = PIECE_VALUES[t];

      if (t === "p") val += PST_PAWN[pstSq];
      else if (t === "n") val += PST_KNIGHT[pstSq];
      else if (t === "b") val += PST_BISHOP[pstSq];
      else if (t === "r") val += PST_ROOK[pstSq];
      else if (t === "q") val += PST_QUEEN[pstSq];
      else if (t === "k") val += isEndgame ? PST_KING_END[pstSq] : PST_KING_MID[pstSq];

      score += isWhite ? val : -val;
    }

    return turn === "w" ? score : -score;
  }

  function scoreMoveForOrdering(state, m, pvMove) {
    if (pvMove && m.from === pvMove.from && m.to === pvMove.to && m.promotion === pvMove.promotion) {
      return 100000;
    }
    let s = 0;
    if (m.capture) {
      const victim = PIECE_VALUES[m.capture.toLowerCase()];
      const attacker = PIECE_VALUES[state.board[m.from].toLowerCase()];
      s += 10000 + victim * 10 - attacker;
    }
    if (m.promotion) s += 8000 + PIECE_VALUES[m.promotion];
    if (m.castle) s += 300;
    return s;
  }

  function orderMoves(state, moves, pvMove = null) {
    return moves
      .map((m) => ({ m, s: scoreMoveForOrdering(state, m, pvMove) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.m);
  }

  const SEARCH_ABORT = Symbol("SEARCH_ABORT");

  function quiescence(state, alpha, beta, qDepth, ctx) {
    if ((++ctx.nodes & 1023) === 0 && Date.now() >= ctx.deadline) throw SEARCH_ABORT;

    const standPat = evaluate(state);
    if (standPat >= beta) return beta;
    if (alpha < standPat) alpha = standPat;
    if (qDepth <= 0) return alpha;

    const legal = generateLegalMoves(state).filter((m) => m.capture || m.promotion);
    const ordered = orderMoves(state, legal);

    for (let i = 0; i < ordered.length; i++) {
      const next = applyRawMove(state, ordered[i]);
      const score = -quiescence(next, -beta, -alpha, qDepth - 1, ctx);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(state, depth, alpha, beta, qMax, ctx) {
    if ((++ctx.nodes & 1023) === 0 && Date.now() >= ctx.deadline) throw SEARCH_ABORT;
    if (state.halfmove >= 100 || isInsufficientMaterial(state.board)) return 0;

    const legal = generateLegalMoves(state);
    if (legal.length === 0) {
      return isInCheck(state, state.turn) ? -100000 - depth : 0;
    }
    if (depth <= 0) return quiescence(state, alpha, beta, qMax, ctx);

    const ordered = orderMoves(state, legal);
    let best = -Infinity;

    for (let i = 0; i < ordered.length; i++) {
      const next = applyRawMove(state, ordered[i]);
      const score = -negamax(next, depth - 1, -beta, -alpha, qMax, ctx);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  function chooseAIMove(state, difficulty = "medium") {
    const legal = generateLegalMoves(state);
    if (legal.length === 0) return null;
    if (legal.length === 1) return legal[0];

    const cfg =
      difficulty === "easy"
        ? { maxDepth: 2, qMax: 0, timeMs: 180, noise: 45 }
        : difficulty === "hard"
        ? { maxDepth: 4, qMax: 4, timeMs: 1200, noise: 0 }
        : { maxDepth: 3, qMax: 2, timeMs: 450, noise: 8 };

    const ctx = { nodes: 0, deadline: Date.now() + cfg.timeMs };
    let bestMove = legal[0];
    let pvMove = null;

    for (let depth = 1; depth <= cfg.maxDepth; depth++) {
      try {
        const ordered = orderMoves(state, legal, pvMove);
        let iterBestMove = ordered[0];
        let iterBestScore = -Infinity;
        let alpha = -Infinity;
        const beta = Infinity;
        const scored = [];

        for (let i = 0; i < ordered.length; i++) {
          const m = ordered[i];
          const next = applyRawMove(state, m);
          const key = getPositionKey(next);
          const repPenalty = (state.positionCounts[key] || 0) >= 2 ? 25 : 0;

          let score = -negamax(next, depth - 1, -beta, -alpha, cfg.qMax, ctx) - repPenalty;
          if (cfg.noise > 0 && depth === cfg.maxDepth) {
            score += (Math.random() * 2 - 1) * cfg.noise;
          }
          scored.push({ m, score });

          if (score > iterBestScore) {
            iterBestScore = score;
            iterBestMove = m;
          }
          if (score > alpha) alpha = score;
        }

        if (difficulty === "easy" && scored.length > 1 && Math.random() < 0.25) {
          scored.sort((a, b) => b.score - a.score);
          bestMove = scored[Math.min(1, scored.length - 1)].m;
        } else {
          bestMove = iterBestMove;
        }
        pvMove = bestMove;
        if (iterBestScore > 90000) break;
      } catch (err) {
        if (err === SEARCH_ABORT) break;
        throw err;
      }
    }

    return bestMove;
  }

  return {
    FILES,
    pieceColor,
    oppositeColor,
    squareToAlg,
    algToSquare,
    stateToFen,
    fenToState,
    createInitialState,
    cloneState,
    findKing,
    isSquareAttacked,
    isInCheck,
    generateLegalMoves,
    makeMove,
    getGameStatus,
    getCapturedAndMaterial,
    chooseAIMove,
  };
}

const Chess = createChessEngine();

const ENGINE_MODULE_SOURCE =
  `const Chess = (${createChessEngine.toString()})();\n` +
  `export const {\n` +
  `  FILES, pieceColor, oppositeColor, squareToAlg, algToSquare,\n` +
  `  stateToFen, fenToState, createInitialState, cloneState, findKing,\n` +
  `  isSquareAttacked, isInCheck, generateLegalMoves, makeMove,\n` +
  `  getGameStatus, getCapturedAndMaterial, chooseAIMove\n` +
  `} = Chess;\n`;

// ============================================================================
// 2. EMBEDDED HTML / CSS / BROWSER UI
// ============================================================================
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bun Chess — Online, LAN &amp; AI</title>
  <style>
    :root {
      --bg: #0f172a;
      --panel: #1e293b;
      --panel-2: #273449;
      --border: #334155;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --accent: #10b981;
      --accent-hover: #059669;
      --blue: #38bdf8;
      --danger: #ef4444;
      --light-sq: #ebecd0;
      --dark-sq: #739552;
      --last-move: rgba(246, 246, 105, 0.52);
      --selected-sq: rgba(20, 184, 166, 0.55);
    }

    body.theme-wood { --light-sq: #f0d9b5; --dark-sq: #b58863; }
    body.theme-blue { --light-sq: #dee3e6; --dark-sq: #8ca2ad; }
    body.theme-slate { --light-sq: #cbd5e1; --dark-sq: #64748b; }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    header {
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.15rem; }

    .badge {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }

    .badge.offline {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.35);
    }

    .badge.internet {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border-color: rgba(56, 189, 248, 0.35);
    }

    .header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    button {
      font: inherit;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      padding: 8px 14px;
      border-radius: 8px;
      font-weight: 600;
      touch-action: manipulation;
      transition: background 0.15s, border-color 0.15s, transform 0.05s;
    }

    button:hover:not(:disabled) { background: #334155; }
    button:active:not(:disabled) { transform: translateY(1px); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }

    button.primary { background: var(--accent); border-color: var(--accent); color: #052e16; }
    button.primary:hover:not(:disabled) { background: var(--accent-hover); }

    button.online-btn {
      background: rgba(56, 189, 248, 0.18);
      border-color: rgba(56, 189, 248, 0.45);
      color: #7dd3fc;
    }
    button.online-btn:hover:not(:disabled) { background: rgba(56, 189, 248, 0.3); }

    button.danger {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.4);
      color: #fca5a5;
    }
    button.danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.28); }
    button.small { padding: 5px 10px; font-size: 0.84rem; }

    input, select {
      font: inherit;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
    }

    main { flex: 1; width: 100%; max-width: 1180px; margin: 0 auto; padding: 20px; }
    @media (max-width: 600px) {
      main { padding: 10px; }
      header { padding: 10px 12px; }
    }

    .hidden { display: none !important; }

    /* LOBBY */
    .lobby-top {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 18px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 14px;
    }

    .name-group { display: flex; align-items: center; gap: 10px; }

    .lan-info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
      color: var(--muted);
    }

    .lan-url-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px 10px;
      color: #38bdf8;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.84rem;
    }

    .tunnel-bar {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(56, 189, 248, 0.08));
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 12px;
      padding: 12px 16px;
      margin-bottom: 14px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .fen-bar {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 16px;
      margin-bottom: 16px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }

    .fen-bar input {
      flex: 1;
      min-width: 220px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.85rem;
    }

    .lobby-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(265px, 1fr));
      gap: 18px;
    }

    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .card h2 { font-size: 1.1rem; display: flex; align-items: center; gap: 8px; }
    .card p.sub { color: var(--muted); font-size: 0.88rem; line-height: 1.4; }
    .form-row { display: flex; flex-direction: column; gap: 5px; }
    .form-row label { font-size: 0.82rem; color: var(--muted); font-weight: 600; }

    .check-row { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; color: var(--text); cursor: pointer; }
    .check-row input { width: 16px; height: 16px; accent-color: var(--accent); }

    .inline-form { display: flex; gap: 8px; }
    .inline-form input { flex: 1; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; }

    .rooms-list { display: flex; flex-direction: column; gap: 8px; max-height: 210px; overflow-y: auto; }

    .room-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .room-meta { font-size: 0.84rem; color: var(--muted); }
    .room-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; color: var(--accent); }

    /* HOST PIN DISPLAY */
    .host-pin-box {
      width: 100%;
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.45);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      text-align: center;
    }

    .host-pin-label {
      font-size: 0.78rem;
      font-weight: 700;
      color: #fcd34d;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .host-pin-digits {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 1.75rem;
      font-weight: 800;
      letter-spacing: 6px;
      color: #ffffff;
    }

    .pin-entry-input {
      width: 190px;
      text-align: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 1.9rem;
      font-weight: 800;
      letter-spacing: 8px;
      padding: 10px 12px;
    }

    .pin-error-text {
      color: #fca5a5;
      font-size: 0.86rem;
      min-height: 18px;
    }

    /* QR BOX & CANVAS */
    .qr-box {
      background: #ffffff;
      padding: 8px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      align-self: center;
    }

    .qr-canvas {
      display: block;
      width: 172px;
      height: 172px;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }

    .qr-canvas.mini { width: 124px; height: 124px; }

    .qr-url-text {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      color: #38bdf8;
      word-break: break-all;
      text-align: center;
    }

    .lobby-qr-preview {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      text-align: center;
    }

    /* GAME VIEW */
    .game-layout {
      display: grid;
      grid-template-columns: minmax(280px, 560px) minmax(290px, 1fr);
      gap: 22px;
      align-items: start;
    }

    @media (max-width: 880px) {
      .game-layout { grid-template-columns: 1fr; }
    }

    .board-column { display: flex; flex-direction: column; gap: 8px; }

    .player-bar {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .player-bar.active-turn {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.35);
    }

    .player-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }

    .player-name {
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); display: inline-block; flex-shrink: 0; }
    .dot.off { background: var(--muted); }

    .captured-row { display: flex; align-items: center; gap: 3px; min-height: 20px; font-size: 0.85rem; color: var(--muted); flex-wrap: wrap; }
    .captured-mini { width: 18px; height: 18px; display: inline-flex; }

    .clock {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 1.15rem;
      font-weight: 700;
      background: var(--bg);
      padding: 6px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      min-width: 78px;
      text-align: center;
    }
    .clock.low { color: #fca5a5; border-color: var(--danger); }

    .board-wrap {
      position: relative;
      width: 100%;
      aspect-ratio: 1 / 1;
      border-radius: 8px;
      overflow: hidden;
      border: 3px solid var(--border);
      user-select: none;
      touch-action: manipulation;
    }

    .board-grid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      grid-template-rows: repeat(8, 1fr);
      width: 100%;
      height: 100%;
    }

    .square { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; touch-action: manipulation; }
    .square.light { background: var(--light-sq); color: var(--dark-sq); }
    .square.dark { background: var(--dark-sq); color: var(--light-sq); }

    .square.last-move::before { content: ""; position: absolute; inset: 0; background: var(--last-move); pointer-events: none; }
    .square.selected::before { content: ""; position: absolute; inset: 0; background: var(--selected-sq); pointer-events: none; }
    .square.in-check { background: radial-gradient(circle, #ef4444 10%, #991b1b 95%) !important; }

    .coord-rank { position: absolute; top: 2px; left: 3px; font-size: 0.68rem; font-weight: 700; pointer-events: none; opacity: 0.85; }
    .coord-file { position: absolute; bottom: 1px; right: 3px; font-size: 0.68rem; font-weight: 700; pointer-events: none; opacity: 0.85; }

    .legal-dot { position: absolute; width: 28%; height: 28%; border-radius: 50%; background: rgba(15, 23, 42, 0.28); pointer-events: none; z-index: 2; }
    .legal-ring { position: absolute; width: 84%; height: 84%; border-radius: 50%; border: 5px solid rgba(15, 23, 42, 0.28); pointer-events: none; z-index: 2; }

    .piece-el { width: 86%; height: 86%; z-index: 3; pointer-events: auto; display: flex; align-items: center; justify-content: center; }
    .piece-el svg { width: 100%; height: 100%; filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.25)); }

    /* SIDEBAR */
    .sidebar { display: flex; flex-direction: column; gap: 12px; }

    .status-box, .moves-box, .chat-box {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .status-title { font-weight: 700; font-size: 1.05rem; }

    .share-banner {
      background: var(--bg);
      border: 1px dashed var(--accent);
      border-radius: 10px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      font-size: 0.88rem;
      text-align: center;
    }

    .draw-banner, .history-banner, .reclaim-banner {
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: 8px;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 0.88rem;
    }

    .controls-row { display: flex; flex-wrap: wrap; gap: 7px; }

    .moves-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .nav-btns { display: flex; gap: 4px; }

    .moves-scroll {
      height: 190px;
      overflow-y: auto;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.88rem;
    }

    .move-row { display: grid; grid-template-columns: 36px 1fr 1fr; padding: 2px 4px; border-radius: 4px; }
    .move-row:nth-child(odd) { background: rgba(255, 255, 255, 0.03); }
    .move-num { color: var(--muted); }
    .move-cell { cursor: pointer; padding: 2px 5px; border-radius: 4px; }
    .move-cell:hover { background: rgba(255, 255, 255, 0.08); }
    .move-cell.active-ply { background: var(--accent); color: #052e16; font-weight: 700; }

    .chat-log {
      height: 115px;
      overflow-y: auto;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      font-size: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .chat-form { display: flex; gap: 6px; }
    .chat-form input { flex: 1; }

    /* MODALS */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.82);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 50;
    }

    .modal-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      width: 100%;
      max-width: 460px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .modal-card h3 { font-size: 1.15rem; }
    .modal-card p, .modal-card li { color: var(--muted); font-size: 0.9rem; line-height: 1.5; }
    .modal-card ul { padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }

    .promo-choices { display: flex; justify-content: center; gap: 10px; }
    .promo-btn { width: 64px; height: 64px; padding: 8px; display: flex; align-items: center; justify-content: center; }

    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--panel-2);
      border: 1px solid var(--border);
      padding: 10px 16px;
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
      z-index: 60;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span>♟ Bun Chess</span>
      <span id="conn-badge" class="badge offline">Connecting...</span>
      <span id="internet-badge" class="badge internet hidden">🌍 Online Link Ready</span>
    </div>
    <div class="header-actions">
      <button id="lobby-qr-btn" class="small">📱 Share QR</button>
      <button id="help-btn" class="small">? Guide</button>
      <button id="settings-btn" class="small">⚙ Settings</button>
    </div>
  </header>

  <main>
    <!-- LOBBY MENU -->
    <section id="lobby-view">
      <div class="lobby-top">
        <div class="name-group">
          <label for="player-name" style="font-weight:600;color:var(--muted);">Your Name</label>
          <input id="player-name" type="text" maxlength="20" placeholder="Player" />
        </div>
        <div class="lan-info">
          <span>Share Links:</span>
          <div id="lan-urls-container" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
            <span class="lan-url-pill">Detecting addresses...</span>
          </div>
        </div>
      </div>

      <!-- SEAMLESS CLOUDFLARE ONLINE LINK BAR -->
      <div class="tunnel-bar">
        <div style="display:flex;flex-direction:column;gap:3px;">
          <div style="font-weight:700;font-size:0.95rem;">🌍 Network-Wide Direct Link (No Sign-In Required)</div>
          <div id="tunnel-status-text" style="font-size:0.84rem;color:var(--muted);">
            Preparing seamless Cloudflare online link...
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button id="toggle-tunnel-btn" class="small online-btn">🌍 Enable Online Link</button>
        </div>
      </div>

      <div class="fen-bar">
        <label for="custom-fen-input" style="font-size:0.85rem;font-weight:600;color:var(--muted);">Optional Custom FEN:</label>
        <input id="custom-fen-input" type="text" placeholder="Leave blank for standard starting position..." />
        <button id="clear-fen-btn" class="small">Clear</button>
      </div>

      <div class="lobby-grid">
        <!-- VS COMPUTER -->
        <div class="card">
          <h2>🤖 Play vs Computer</h2>
          <p class="sub">Play offline against the built-in Alpha-Beta engine.</p>

          <div class="form-row">
            <label for="ai-diff">Difficulty</label>
            <select id="ai-diff">
              <option value="easy">Easy (Casual)</option>
              <option value="medium" selected>Medium (Balanced)</option>
              <option value="hard">Hard (Tactical)</option>
            </select>
          </div>

          <div class="form-row">
            <label for="ai-color">Your Color</label>
            <select id="ai-color">
              <option value="w">White</option>
              <option value="b">Black</option>
              <option value="random">Random</option>
            </select>
          </div>

          <div class="form-row">
            <label for="ai-tc">Time Control</label>
            <select id="ai-tc">
              <option value="0|0" selected>Unlimited</option>
              <option value="60|0">1 + 0 (Bullet)</option>
              <option value="180|2">3 + 2 (Blitz)</option>
              <option value="300|0">5 + 0 (Blitz)</option>
              <option value="600|0">10 + 0 (Rapid)</option>
              <option value="900|10">15 + 10 (Classical)</option>
            </select>
          </div>

          <button id="start-ai-btn" class="primary" style="margin-top:auto;">Start vs Computer</button>
        </div>

        <!-- HOST LAN / ONLINE -->
        <div class="card">
          <h2>🌐 Host Multiplayer Game</h2>
          <p class="sub">Create a PIN-protected room. Anyone with the link just enters the 4-digit PIN on your screen.</p>

          <div class="form-row">
            <label for="lan-color">Your Color</label>
            <select id="lan-color">
              <option value="random" selected>Random</option>
              <option value="w">White</option>
              <option value="b">Black</option>
            </select>
          </div>

          <div class="form-row">
            <label for="lan-tc">Time Control</label>
            <select id="lan-tc">
              <option value="0|0" selected>Unlimited</option>
              <option value="60|0">1 + 0 (Bullet)</option>
              <option value="180|2">3 + 2 (Blitz)</option>
              <option value="300|0">5 + 0 (Blitz)</option>
              <option value="600|0">10 + 0 (Rapid)</option>
              <option value="900|10">15 + 10 (Classical)</option>
            </select>
          </div>

          <label class="check-row">
            <input id="lan-private" type="checkbox" />
            <span>Private room (hide from Open Rooms list)</span>
          </label>

          <div class="lobby-qr-preview">
            <div id="lobby-card-qr-label" style="font-size:0.78rem;color:var(--muted);">Quick Connect QR</div>
            <div class="qr-box" style="padding:6px;">
              <canvas id="lobby-card-qr" class="qr-canvas mini"></canvas>
            </div>
            <div id="lobby-card-url" class="qr-url-text"></div>
          </div>

          <button id="host-lan-btn" class="primary">Create Room + Join Link</button>
        </div>

        <!-- JOIN ROOM -->
        <div class="card">
          <h2>🔗 Join Multiplayer Game</h2>
          <p class="sub">Enter a Room Code or pick an open room. You will be asked for the host's 4-digit PIN.</p>

          <div class="inline-form">
            <input id="join-code-input" type="text" maxlength="4" placeholder="CODE" />
            <button id="join-code-btn" class="primary">Join</button>
          </div>

          <div class="form-row">
            <label>Open Rooms</label>
            <div id="rooms-list" class="rooms-list">
              <div class="room-meta">No open rooms right now.</div>
            </div>
          </div>
        </div>

        <!-- PASS & PLAY -->
        <div class="card">
          <h2>👥 Pass &amp; Play (Same Device)</h2>
          <p class="sub">Two players share one screen on the same computer or tablet.</p>

          <div class="form-row">
            <label for="local-tc">Time Control</label>
            <select id="local-tc">
              <option value="0|0" selected>Unlimited</option>
              <option value="180|2">3 + 2 (Blitz)</option>
              <option value="300|0">5 + 0 (Blitz)</option>
              <option value="600|0">10 + 0 (Rapid)</option>
            </select>
          </div>

          <label class="check-row">
            <input id="local-autoflip" type="checkbox" checked />
            <span>Auto-flip board after each move</span>
          </label>

          <button id="start-local-btn" class="primary" style="margin-top:auto;">Start Pass &amp; Play</button>
        </div>
      </div>
    </section>

    <!-- GAME VIEW -->
    <section id="game-view" class="hidden">
      <div class="game-layout">
        <div class="board-column">
          <div id="top-player-bar" class="player-bar">
            <div class="player-info">
              <div class="player-name">
                <span id="top-dot" class="dot"></span>
                <span id="top-name">Opponent</span>
              </div>
              <div id="top-captured" class="captured-row"></div>
            </div>
            <div id="top-clock" class="clock hidden">--:--</div>
          </div>

          <div class="board-wrap">
            <div id="board-grid" class="board-grid"></div>
          </div>

          <div id="bottom-player-bar" class="player-bar">
            <div class="player-info">
              <div class="player-name">
                <span id="bottom-dot" class="dot"></span>
                <span id="bottom-name">You</span>
              </div>
              <div id="bottom-captured" class="captured-row"></div>
            </div>
            <div id="bottom-clock" class="clock hidden">--:--</div>
          </div>
        </div>

        <aside class="sidebar">
          <div class="status-box">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <span id="game-status-title" class="status-title">White to move</span>
              <span id="room-badge" class="badge">ROOM</span>
            </div>

            <!-- WAITING + QR CODE + HOST-ONLY PIN BANNER -->
            <div id="share-banner" class="share-banner hidden">
              <div id="share-title" style="font-weight:700;">📱 Share Link or Scan QR to Join</div>

              <div id="share-pin-box" class="host-pin-box hidden">
                <div class="host-pin-label">🔒 Host-Only Entry PIN</div>
                <div id="share-pin-digits" class="host-pin-digits">----</div>
                <div style="font-size:0.76rem;color:var(--muted);">Tell your opponent this 4-digit PIN to let them join</div>
              </div>

              <div class="qr-box">
                <canvas id="share-qr-canvas" class="qr-canvas"></canvas>
              </div>
              <div id="share-url-text" class="qr-url-text"></div>

              <div id="share-ip-row" class="hidden" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center;">
                <label for="share-ip-select" style="font-size:0.78rem;color:var(--muted);">Route:</label>
                <select id="share-ip-select" style="padding:4px 8px;font-size:0.8rem;max-width:260px;"></select>
              </div>

              <div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;">
                <span>Code: <strong id="share-code" class="room-code"></strong></span>
                <button id="copy-link-btn" class="small primary">Copy Join Link</button>
                <button id="share-go-online-btn" class="small online-btn">🌍 Online Link</button>
              </div>
            </div>

            <div id="reclaim-banner" class="reclaim-banner hidden">
              <span>A player disconnected from this game.</span>
              <button id="claim-seat-btn" class="small primary">⚡ Reclaim Seat</button>
            </div>

            <div id="draw-banner" class="draw-banner hidden">
              <span>Opponent offered a draw.</span>
              <div style="display:flex;gap:6px;">
                <button id="accept-draw-btn" class="small primary">Accept</button>
                <button id="decline-draw-btn" class="small danger">Decline</button>
              </div>
            </div>

            <div id="history-banner" class="history-banner hidden">
              <span>Viewing past move (read-only)</span>
              <button id="jump-live-btn" class="small primary">Live Board</button>
            </div>

            <div class="controls-row">
              <button id="flip-btn" class="small" title="Shortcut: F">⇅ Flip</button>
              <button id="room-qr-btn" class="small hidden">📱 Share / PIN</button>
              <button id="undo-btn" class="small hidden">↶ Undo</button>
              <button id="draw-btn" class="small hidden">½ Draw</button>
              <button id="resign-btn" class="small danger">🏳 Resign</button>
              <button id="rematch-btn" class="small primary hidden">↻ Rematch</button>
              <button id="leave-btn" class="small">← Main Menu</button>
            </div>
          </div>

          <div class="moves-box">
            <div class="moves-header">
              <strong style="font-size:0.95rem;">Moves</strong>
              <div class="nav-btns">
                <button id="nav-first" class="small" title="Start">|&lt;</button>
                <button id="nav-prev" class="small" title="Previous (Left Arrow)">&lt;</button>
                <button id="nav-next" class="small" title="Next (Right Arrow)">&gt;</button>
                <button id="nav-last" class="small" title="Live">&gt;|</button>
              </div>
            </div>
            <div id="moves-scroll" class="moves-scroll"></div>
            <div style="display:flex;gap:8px;">
              <button id="copy-pgn-btn" class="small" style="flex:1;">Copy PGN</button>
              <button id="copy-fen-btn" class="small" style="flex:1;">Copy FEN</button>
            </div>
          </div>

          <div id="chat-box" class="chat-box hidden">
            <strong style="font-size:0.95rem;">Game Chat</strong>
            <div id="chat-log" class="chat-log"></div>
            <form id="chat-form" class="chat-form">
              <input id="chat-input" type="text" maxlength="200" placeholder="Say hello..." />
              <button type="submit" class="small">Send</button>
            </form>
          </div>
        </aside>
      </div>
    </section>
  </main>

  <!-- 4-DIGIT HOST PIN ENTRY MODAL (Shown to Joining Players) -->
  <div id="pin-modal" class="modal-backdrop hidden">
    <form id="pin-form" class="modal-card" style="max-width:380px;align-items:center;text-align:center;">
      <h3>🔒 Enter 4-Digit Host PIN</h3>
      <p id="pin-modal-sub">Ask the host for the 4-digit PIN displayed on their screen to join this party.</p>
      <div class="form-row" style="width:100%;text-align:left;">
        <label for="pin-name-input">Your Name</label>
        <input id="pin-name-input" type="text" maxlength="20" placeholder="Player" />
      </div>
      <input id="pin-input" class="pin-entry-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="0000" required />
      <div id="pin-error-text" class="pin-error-text"></div>
      <div style="display:flex;gap:8px;width:100%;">
        <button id="pin-submit-btn" type="submit" class="primary" style="flex:1;">Join Game</button>
        <button id="pin-cancel-btn" type="button" style="flex:1;">Cancel</button>
      </div>
    </form>
  </div>

  <!-- QR CODE POPUP MODAL -->
  <div id="qr-modal" class="modal-backdrop hidden">
    <div class="modal-card" style="max-width:400px;align-items:center;text-align:center;">
      <h3 id="qr-modal-title">📱 Scan or Share Join Link</h3>
      <p id="qr-modal-sub">Switch Route to "Internet" for friends on different networks, or "LAN" for same Wi-Fi.</p>
      <div id="qr-modal-pin-box" class="host-pin-box hidden">
        <div class="host-pin-label">🔒 Host-Only Entry PIN</div>
        <div id="qr-modal-pin-digits" class="host-pin-digits">----</div>
      </div>
      <div class="qr-box">
        <canvas id="qr-modal-canvas" class="qr-canvas"></canvas>
      </div>
      <div id="qr-modal-url" class="qr-url-text"></div>
      <div id="qr-modal-ip-row" class="hidden" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center;">
        <label for="qr-modal-ip-select" style="font-size:0.8rem;color:var(--muted);">Route:</label>
        <select id="qr-modal-ip-select" style="padding:4px 8px;font-size:0.82rem;max-width:280px;"></select>
      </div>
      <div style="display:flex;gap:8px;width:100%;flex-wrap:wrap;">
        <button id="qr-modal-online-btn" class="online-btn" style="flex:1;">🌍 Online Link</button>
        <button id="qr-modal-copy-btn" class="primary" style="flex:1;">Copy URL</button>
        <button id="close-qr-modal-btn" style="flex:1;">Close</button>
      </div>
    </div>
  </div>

  <!-- PROMOTION MODAL -->
  <div id="promo-modal" class="modal-backdrop hidden">
    <div class="modal-card" style="max-width:340px;align-items:center;">
      <h3>Choose Promotion</h3>
      <div id="promo-choices" class="promo-choices"></div>
    </div>
  </div>

  <!-- SETTINGS MODAL -->
  <div id="settings-modal" class="modal-backdrop hidden">
    <div class="modal-card">
      <h3>⚙ Game Settings</h3>
      <div class="form-row">
        <label for="opt-theme">Board Theme</label>
        <select id="opt-theme">
          <option value="green">Tournament Green</option>
          <option value="wood">Classic Wood</option>
          <option value="blue">Ocean Blue</option>
          <option value="slate">Modern Slate</option>
        </select>
      </div>
      <label class="check-row"><input id="opt-sound" type="checkbox" /><span>Sound Effects</span></label>
      <label class="check-row"><input id="opt-hints" type="checkbox" /><span>Show Legal Move Dots</span></label>
      <label class="check-row"><input id="opt-coords" type="checkbox" /><span>Show Rank/File Coordinates</span></label>
      <label class="check-row"><input id="opt-autoqueen" type="checkbox" /><span>Auto-Promote Pawns to Queen</span></label>
      <button id="close-settings-btn" class="primary">Done</button>
    </div>
  </div>

  <!-- HELP / NETWORK GUIDE MODAL -->
  <div id="help-modal" class="modal-backdrop hidden">
    <div class="modal-card">
      <h3>♟ Rules &amp; Network Play Guide</h3>
      <ul>
        <li><strong>Seamless Network-Wide Link:</strong> Uses Cloudflare Quick Tunnels automatically (no account, no sign-in, no warning screens).</li>
        <li><strong>4-Digit Host PIN:</strong> Every party is locked with a random 4-digit PIN shown <em>only on the host's screen</em>. Friends just click the URL and type the PIN to play.</li>
        <li><strong>Same Wi-Fi (LAN):</strong> You can also pick your local Wi-Fi IP from the <em>Route</em> dropdown anytime (e.g. if playing offline on local Wi-Fi).</li>
        <li><strong>Shortcuts:</strong> <code>F</code> flips the board. <code>←</code> / <code>→</code> / <code>Home</code> / <code>End</code> browse move history.</li>
      </ul>
      <button id="close-help-btn" class="primary">Got It</button>
    </div>
  </div>

  <!-- GAME OVER MODAL -->
  <div id="gameover-modal" class="modal-backdrop hidden">
    <div class="modal-card" style="max-width:380px;text-align:center;">
      <h3 id="gameover-title">Game Over</h3>
      <p id="gameover-sub">Checkmate</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">
        <button id="gameover-rematch-btn" class="primary">↻ Play Rematch</button>
        <button id="gameover-review-btn">Review Board &amp; Moves</button>
        <button id="gameover-lobby-btn">← Main Menu</button>
      </div>
    </div>
  </div>

  <div id="toast" class="toast hidden"></div>

  <script type="module">
    import {
      FILES,
      pieceColor,
      fenToState,
      stateToFen,
      generateLegalMoves,
      getGameStatus,
      getCapturedAndMaterial,
      findKing,
    } from "/engine.js";

    // =========================================================================
    // ZERO-DEPENDENCY ISO 18004 QR CODE CANVAS RENDERER (V1..V6, EC-M & EC-L)
    // =========================================================================
    const renderQrToCanvas = (function () {
      const GF_EXP = new Uint8Array(512);
      const GF_LOG = new Uint8Array(256);
      let gx = 1;
      for (let i = 0; i < 255; i++) {
        GF_EXP[i] = gx;
        GF_LOG[gx] = i;
        gx <<= 1;
        if (gx & 0x100) gx ^= 0x11d;
      }
      for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];

      function gfMul(a, b) {
        return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
      }

      function rsGeneratorPoly(deg) {
        let poly = [1];
        for (let i = 0; i < deg; i++) {
          const next = new Array(poly.length + 1).fill(0);
          const factor = GF_EXP[i];
          for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];
            next[j + 1] ^= gfMul(poly[j], factor);
          }
          poly = next;
        }
        return poly;
      }

      function rsRemainder(data, ecLen) {
        const gen = rsGeneratorPoly(ecLen);
        const res = new Uint8Array(data.length + ecLen);
        res.set(data, 0);
        for (let i = 0; i < data.length; i++) {
          const coef = res[i];
          if (coef !== 0) {
            for (let j = 0; j < gen.length; j++) {
              res[i + j] ^= gfMul(gen[j], coef);
            }
          }
        }
        return res.slice(data.length);
      }

      const SPECS = [
        { ecBits: 0, size: 21, totalData: 16, blocks: 1, blockData: 16, ecPerBlock: 10, align: null },
        { ecBits: 0, size: 25, totalData: 28, blocks: 1, blockData: 28, ecPerBlock: 16, align: 18 },
        { ecBits: 0, size: 29, totalData: 44, blocks: 1, blockData: 44, ecPerBlock: 26, align: 22 },
        { ecBits: 0, size: 33, totalData: 64, blocks: 2, blockData: 32, ecPerBlock: 18, align: 26 },
        { ecBits: 0, size: 37, totalData: 86, blocks: 2, blockData: 43, ecPerBlock: 24, align: 30 },
        { ecBits: 0, size: 41, totalData: 108, blocks: 4, blockData: 27, ecPerBlock: 16, align: 34 },
        { ecBits: 1, size: 41, totalData: 136, blocks: 2, blockData: 68, ecPerBlock: 18, align: 34 },
      ];

      function getFormatBits(ecBits, mask) {
        const data = (ecBits << 3) | mask;
        let d = data << 10;
        for (let i = 14; i >= 10; i--) {
          if (d & (1 << i)) d ^= 0x537 << (i - 10);
        }
        return ((data << 10) | d) ^ 0x5412;
      }

      function maskFn(m, r, c) {
        if (m === 0) return (r + c) % 2 === 0;
        if (m === 1) return r % 2 === 0;
        if (m === 2) return c % 3 === 0;
        if (m === 3) return (r + c) % 3 === 0;
        if (m === 4) return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        if (m === 5) return ((r * c) % 2) + ((r * c) % 3) === 0;
        if (m === 6) return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
        return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      }

      function penaltyScore(grid, size) {
        let score = 0;
        for (let r = 0; r < size; r++) {
          let run = 1;
          for (let c = 1; c < size; c++) {
            if (grid[r][c] === grid[r][c - 1]) {
              run++;
              if (run === 5) score += 3;
              else if (run > 5) score += 1;
            } else run = 1;
          }
        }
        for (let c = 0; c < size; c++) {
          let run = 1;
          for (let r = 1; r < size; r++) {
            if (grid[r][c] === grid[r - 1][c]) {
              run++;
              if (run === 5) score += 3;
              else if (run > 5) score += 1;
            } else run = 1;
          }
        }
        for (let r = 0; r < size - 1; r++) {
          for (let c = 0; c < size - 1; c++) {
            const v = grid[r][c];
            if (grid[r][c + 1] === v && grid[r + 1][c] === v && grid[r + 1][c + 1] === v) score += 3;
          }
        }
        function checkLine(arr) {
          let p = 0;
          for (let i = 0; i <= arr.length - 7; i++) {
            const match =
              arr[i] === 1 && arr[i + 1] === 0 && arr[i + 2] === 1 &&
              arr[i + 3] === 1 && arr[i + 4] === 1 && arr[i + 5] === 0 && arr[i + 6] === 1;
            if (match) {
              const leftWhite = i >= 4 && !arr[i - 1] && !arr[i - 2] && !arr[i - 3] && !arr[i - 4];
              const rightWhite = i + 10 < arr.length && !arr[i + 7] && !arr[i + 8] && !arr[i + 9] && !arr[i + 10];
              if (leftWhite || rightWhite) p += 40;
            }
          }
          return p;
        }
        for (let r = 0; r < size; r++) score += checkLine(grid[r]);
        const colArr = new Uint8Array(size);
        for (let c = 0; c < size; c++) {
          for (let r = 0; r < size; r++) colArr[r] = grid[r][c];
          score += checkLine(colArr);
        }
        let dark = 0;
        for (let r = 0; r < size; r++) {
          for (let c = 0; c < size; c++) if (grid[r][c]) dark++;
        }
        score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
        return score;
      }

      function encodeQrMatrix(text) {
        const bytes = new TextEncoder().encode(String(text));
        let ver = null;
        for (let i = 0; i < SPECS.length; i++) {
          if (bytes.length <= SPECS[i].totalData - 2) {
            ver = SPECS[i];
            break;
          }
        }
        if (!ver) return null;

        const bits = [];
        function pushBits(val, count) {
          for (let i = count - 1; i >= 0; i--) bits.push((val >> i) & 1);
        }
        pushBits(4, 4);
        pushBits(bytes.length, 8);
        for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
        const maxBits = ver.totalData * 8;
        const termLen = Math.min(4, maxBits - bits.length);
        for (let i = 0; i < termLen; i++) bits.push(0);
        while (bits.length % 8 !== 0) bits.push(0);

        const dataBytes = [];
        for (let i = 0; i < bits.length; i += 8) {
          let b = 0;
          for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
          dataBytes.push(b);
        }
        const padBytes = [0xec, 0x11];
        let padIdx = 0;
        while (dataBytes.length < ver.totalData) {
          dataBytes.push(padBytes[padIdx % 2]);
          padIdx++;
        }

        const dataBlocks = [];
        const ecBlocks = [];
        for (let b = 0; b < ver.blocks; b++) {
          const slice = new Uint8Array(dataBytes.slice(b * ver.blockData, (b + 1) * ver.blockData));
          dataBlocks.push(slice);
          ecBlocks.push(rsRemainder(slice, ver.ecPerBlock));
        }

        const codewords = [];
        for (let i = 0; i < ver.blockData; i++) {
          for (let b = 0; b < ver.blocks; b++) codewords.push(dataBlocks[b][i]);
        }
        for (let i = 0; i < ver.ecPerBlock; i++) {
          for (let b = 0; b < ver.blocks; b++) codewords.push(ecBlocks[b][i]);
        }

        const size = ver.size;
        const base = Array.from({ length: size }, () => new Uint8Array(size));
        const reserved = Array.from({ length: size }, () => new Uint8Array(size));

        function setFunc(r, c, val) {
          if (r >= 0 && r < size && c >= 0 && c < size) {
            base[r][c] = val ? 1 : 0;
            reserved[r][c] = 1;
          }
        }

        function drawFinder(topR, topC) {
          for (let dr = -1; dr <= 7; dr++) {
            for (let dc = -1; dc <= 7; dc++) {
              const r = topR + dr;
              const c = topC + dc;
              if (r < 0 || r >= size || c < 0 || c >= size) continue;
              const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
              const isDark =
                inOuter &&
                (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
              setFunc(r, c, isDark ? 1 : 0);
            }
          }
        }

        drawFinder(0, 0);
        drawFinder(0, size - 7);
        drawFinder(size - 7, 0);

        if (ver.align !== null) {
          const ar = ver.align;
          const ac = ver.align;
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const isDark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
              setFunc(ar + dr, ac + dc, isDark ? 1 : 0);
            }
          }
        }

        for (let i = 8; i < size - 8; i++) {
          const val = i % 2 === 0 ? 1 : 0;
          if (!reserved[6][i]) setFunc(6, i, val);
          if (!reserved[i][6]) setFunc(i, 6, val);
        }

        setFunc(size - 8, 8, 1);
        for (let i = 0; i <= 8; i++) {
          if (i !== 6) {
            reserved[8][i] = 1;
            reserved[i][8] = 1;
          }
        }
        for (let i = 0; i < 8; i++) reserved[8][size - 1 - i] = 1;
        for (let i = 0; i < 7; i++) reserved[size - 1 - i][8] = 1;

        let bitIdx = 0;
        const totalBits = codewords.length * 8;
        let up = true;
        for (let col = size - 1; col > 0; col -= 2) {
          if (col === 6) col--;
          for (let step = 0; step < size; step++) {
            const r = up ? size - 1 - step : step;
            for (let dc = 0; dc < 2; dc++) {
              const c = col - dc;
              if (!reserved[r][c]) {
                let bit = 0;
                if (bitIdx < totalBits) {
                  bit = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
                  bitIdx++;
                }
                base[r][c] = bit;
              }
            }
          }
          up = !up;
        }

        let bestGrid = null;
        let bestScore = Infinity;

        for (let m = 0; m < 8; m++) {
          const g = Array.from({ length: size }, (_, r) => base[r].slice());
          for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
              if (!reserved[r][c] && maskFn(m, r, c)) g[r][c] ^= 1;
            }
          }

          const fmt = getFormatBits(ver.ecBits, m);
          const topLeftCoords = [
            [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
            [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
          ];
          for (let i = 0; i < 15; i++) {
            const bit = (fmt >> (14 - i)) & 1;
            const [r1, c1] = topLeftCoords[i];
            g[r1][c1] = bit;
            if (i < 7) g[size - 1 - i][8] = bit;
            else g[8][size - 15 + i] = bit;
          }

          const sc = penaltyScore(g, size);
          if (sc < bestScore) {
            bestScore = sc;
            bestGrid = g;
          }
        }

        return { grid: bestGrid, size };
      }

      return function (canvas, text, targetSizePx = 220) {
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const qr = encodeQrMatrix(text);
        if (!qr) {
          canvas.width = 180;
          canvas.height = 180;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, 180, 180);
          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 12px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("URL too long for QR", 90, 90);
          return;
        }
        const quiet = 4;
        const full = qr.size + quiet * 2;
        const scale = Math.max(4, Math.floor(targetSizePx / full));
        const px = full * scale;
        canvas.width = px;
        canvas.height = px;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, px, px);
        ctx.fillStyle = "#0f172a";
        for (let r = 0; r < qr.size; r++) {
          for (let c = 0; c < qr.size; c++) {
            if (qr.grid[r][c]) {
              ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
            }
          }
        }
      };
    })();

    function getPieceSvg(piece) {
      const isWhite = piece === piece.toUpperCase();
      const fill = isWhite ? "#ffffff" : "#1e293b";
      const stroke = isWhite ? "#0f172a" : "#020617";
      const detail = isWhite ? "#0f172a" : "#e2e8f0";
      const t = piece.toLowerCase();

      if (t === "p") {
        return '<svg viewBox="0 0 45 45"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round"/></svg>';
      }
      if (t === "r") {
        return '<svg viewBox="0 0 45 45"><g fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5"/><path d="M34 14l-3 3H14l-3-3"/><path d="M31 17v12.5H14V17"/><path d="M31 29.5l1.5 2.5h-20l1.5-2.5"/><path d="M11 14h23" fill="none" stroke="' + detail + '"/></g></svg>';
      }
      if (t === "n") {
        return '<svg viewBox="0 0 45 45"><g fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/><path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3"/><circle cx="15" cy="15.5" r="1.2" fill="' + detail + '" stroke="none"/></g></svg>';
      }
      if (t === "b") {
        return '<svg viewBox="0 0 45 45"><g fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z"/><path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><circle cx="22.5" cy="8" r="2.5"/><path d="M17.5 26h10M15 30h15M22.5 15.5v5M20 18h5" fill="none" stroke="' + detail + '"/></g></svg>';
      }
      if (t === "q") {
        return '<svg viewBox="0 0 45 45"><g fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.5"/><circle cx="14" cy="9" r="2.5"/><circle cx="22.5" cy="8" r="2.5"/><circle cx="31" cy="9" r="2.5"/><circle cx="39" cy="12" r="2.5"/><path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5 9 26z"/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z"/><path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0" fill="none" stroke="' + detail + '"/></g></svg>';
      }
      if (t === "k") {
        return '<svg viewBox="0 0 45 45"><g fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22.5 11.63V6M20 8h5" fill="none" stroke="' + stroke + '" stroke-width="2"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"/><path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z"/><path d="M11.5 30c5.5-3 15.5-3 21 0M11.5 33.5c5.5-3 15.5-3 21 0M11.5 37c5.5-3 15.5-3 21 0" fill="none" stroke="' + detail + '"/></g></svg>';
      }
      return "";
    }

    function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      }
      fallbackCopy(text);
    }

    function fallbackCopy(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }

    const defaultSettings = { theme: "green", sound: true, hints: true, coords: true, autoQueen: false };
    let settings = { ...defaultSettings };
    try {
      const saved = JSON.parse(localStorage.getItem("bunChessSettings") || "null");
      if (saved) settings = { ...defaultSettings, ...saved };
    } catch {}

    function applySettings() {
      document.body.className = settings.theme === "green" ? "" : "theme-" + settings.theme;
      document.getElementById("opt-theme").value = settings.theme;
      document.getElementById("opt-sound").checked = settings.sound;
      document.getElementById("opt-hints").checked = settings.hints;
      document.getElementById("opt-coords").checked = settings.coords;
      document.getElementById("opt-autoqueen").checked = settings.autoQueen;
      localStorage.setItem("bunChessSettings", JSON.stringify(settings));
      if (currentGame) renderBoard();
    }

    let audioCtx = null;
    function playSound(type) {
      if (!settings.sound) return;
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;
        if (type === "capture") {
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(110, now + 0.09);
        } else if (type === "check") {
          osc.frequency.setValueAtTime(520, now);
          osc.frequency.exponentialRampToValueAtTime(340, now + 0.14);
        } else if (type === "end") {
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.exponentialRampToValueAtTime(660, now + 0.22);
        } else {
          osc.frequency.setValueAtTime(300, now);
          osc.frequency.exponentialRampToValueAtTime(180, now + 0.06);
        }
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.2);
      } catch {}
    }

    let clientId = sessionStorage.getItem("bunChessClientId") || "";
    const nameInput = document.getElementById("player-name");
    nameInput.value = localStorage.getItem("bunChessName") || ("Player-" + Math.floor(100 + Math.random() * 900));
    nameInput.addEventListener("change", () => {
      localStorage.setItem("bunChessName", nameInput.value.trim() || "Player");
    });

    let ws = null;
    let lanEntries = [];
    let tunnelState = { status: "idle", url: null, provider: null, message: null, error: null };
    let selectedRouteIdx = 0;
    let currentGame = null;
    let pendingPinRoomId = null;
    let boardFlipped = false;
    let selectedSq = null;
    let legalMovesCache = [];
    let pendingPromotion = null;
    let dragFromSq = null;
    let localClockInterval = null;
    let lastMoveCount = 0;
    let lastStatus = null;
    let viewPly = null;
    let resignArmed = false;
    let resignTimer = null;

    const connBadge = document.getElementById("conn-badge");
    const internetBadge = document.getElementById("internet-badge");
    const lobbyView = document.getElementById("lobby-view");
    const gameView = document.getElementById("game-view");
    const boardGrid = document.getElementById("board-grid");
    const movesScroll = document.getElementById("moves-scroll");
    const chatBox = document.getElementById("chat-box");
    const chatLog = document.getElementById("chat-log");
    const promoModal = document.getElementById("promo-modal");
    const promoChoices = document.getElementById("promo-choices");
    const gameOverModal = document.getElementById("gameover-modal");
    const qrModal = document.getElementById("qr-modal");
    const pinModal = document.getElementById("pin-modal");
    const pinInput = document.getElementById("pin-input");
    const pinNameInput = document.getElementById("pin-name-input");
    const pinErrorText = document.getElementById("pin-error-text");

    function showToast(msg) {
      const t = document.getElementById("toast");
      t.textContent = msg;
      t.classList.remove("hidden");
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(() => t.classList.add("hidden"), 3200);
    }

    function sendWs(payload) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        return true;
      }
      showToast("Connecting to server... please try again.");
      return false;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function getAllRoutes() {
      const routes = [];
      if (tunnelState.status === "active" && tunnelState.url) {
        routes.push({ label: "🌍 Internet (Direct)", url: tunnelState.url });
      }
      for (const e of lanEntries) {
        routes.push({ label: "📶 LAN (" + e.iface + ")", url: e.url });
      }
      if (routes.length === 0) {
        routes.push({ label: "Local", url: location.origin });
      }
      return routes;
    }

    function getActiveBaseUrl() {
      const routes = getAllRoutes();
      return routes[selectedRouteIdx] ? routes[selectedRouteIdx].url : routes[0].url;
    }

    function getJoinUrl(roomId = null) {
      const base = getActiveBaseUrl();
      return roomId ? base + "/?room=" + roomId : base;
    }

    function openPinPrompt(roomId, hostName, errMsg = "") {
      pendingPinRoomId = roomId;
      document.getElementById("pin-modal-sub").textContent =
        "Enter the 4-digit PIN displayed on " + (hostName || "the host") + "'s screen to join room " + roomId + ".";
      pinNameInput.value = nameInput.value.trim() || "Player";
      pinErrorText.textContent = errMsg;
      if (!errMsg) pinInput.value = "";
      pinModal.classList.remove("hidden");
      setTimeout(() => {
        pinInput.focus();
        pinInput.select();
      }, 30);
    }

    pinInput.addEventListener("input", () => {
      pinInput.value = pinInput.value.replace(/[^0-9]/g, "").slice(0, 4);
    });

    document.getElementById("pin-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!pendingPinRoomId) return;
      const pin = pinInput.value.trim();
      if (pin.length !== 4) {
        pinErrorText.textContent = "Please enter all 4 digits.";
        return;
      }
      const chosenName = pinNameInput.value.trim() || nameInput.value.trim() || "Player";
      nameInput.value = chosenName;
      localStorage.setItem("bunChessName", chosenName);
      pinErrorText.textContent = "";
      sendWs({
        type: "join_room",
        roomId: pendingPinRoomId,
        pin,
        name: chosenName,
      });
    });

    document.getElementById("pin-cancel-btn").addEventListener("click", () => {
      pendingPinRoomId = null;
      pinModal.classList.add("hidden");
      const url = new URL(location.href);
      if (url.searchParams.has("room")) {
        url.searchParams.delete("room");
        history.replaceState(null, "", url.toString());
      }
    });

    function updateTunnelUi() {
      const btn = document.getElementById("toggle-tunnel-btn");
      const statusText = document.getElementById("tunnel-status-text");
      const shareBtn = document.getElementById("share-go-online-btn");
      const modalBtn = document.getElementById("qr-modal-online-btn");

      if (tunnelState.status === "active" && tunnelState.url) {
        internetBadge.classList.remove("hidden");
        internetBadge.textContent = "🌍 Online Link Ready";
        statusText.innerHTML = 'Direct link ready: <strong style="color:#38bdf8;">' + escapeHtml(tunnelState.url) + '</strong> — zero sign-in, just click &amp; enter your 4-digit PIN!';
        btn.textContent = "Stop Online Link";
        btn.classList.remove("online-btn");
        btn.classList.add("danger");
        btn.disabled = false;
        shareBtn.classList.add("hidden");
        modalBtn.textContent = "Stop Online";
        modalBtn.disabled = false;
      } else if (tunnelState.status === "starting") {
        internetBadge.classList.add("hidden");
        statusText.textContent = tunnelState.message || "Starting Cloudflare Quick Tunnel (no sign-in required)...";
        btn.textContent = "⏳ Connecting...";
        btn.disabled = true;
        shareBtn.textContent = "⏳ Connecting...";
        shareBtn.disabled = true;
        modalBtn.textContent = "⏳ Connecting...";
        modalBtn.disabled = true;
      } else {
        internetBadge.classList.add("hidden");
        statusText.textContent = tunnelState.error
          ? "Online tunnel unavailable (" + tunnelState.error + "). LAN/Wi-Fi still works."
          : "LAN / Wi-Fi mode. Click Enable Online Link to generate a direct Cloudflare HTTPS link.";
        btn.textContent = "🌍 Enable Online Link";
        btn.classList.add("online-btn");
        btn.classList.remove("danger");
        btn.disabled = false;
        shareBtn.classList.remove("hidden");
        shareBtn.textContent = "🌍 Online Link";
        shareBtn.disabled = false;
        modalBtn.textContent = "🌍 Online Link";
        modalBtn.disabled = false;
      }
    }

    function toggleOnlineTunnel() {
      if (tunnelState.status === "active") {
        sendWs({ type: "stop_tunnel" });
      } else if (tunnelState.status !== "starting") {
        sendWs({ type: "start_tunnel" });
      }
    }

    document.getElementById("toggle-tunnel-btn").addEventListener("click", toggleOnlineTunnel);
    document.getElementById("share-go-online-btn").addEventListener("click", toggleOnlineTunnel);
    document.getElementById("qr-modal-online-btn").addEventListener("click", toggleOnlineTunnel);

    function updateLobbyQr() {
      const url = getJoinUrl(null);
      renderQrToCanvas(document.getElementById("lobby-card-qr"), url, 150);
      document.getElementById("lobby-card-url").textContent = url;
      document.getElementById("lobby-card-qr-label").textContent =
        tunnelState.status === "active" ? "🌍 Network-Wide QR (Any Network)" : "📶 Quick Connect QR (LAN / Wi-Fi)";
    }

    function updateShareQr() {
      if (!currentGame) return;
      const routes = getAllRoutes();
      if (selectedRouteIdx >= routes.length) selectedRouteIdx = 0;

      const url = getJoinUrl(currentGame.roomId);
      renderQrToCanvas(document.getElementById("share-qr-canvas"), url, 210);
      document.getElementById("share-url-text").textContent = url;
      document.getElementById("share-title").textContent =
        tunnelState.status === "active" && selectedRouteIdx === 0
          ? "🌍 Share Direct Link or Scan QR (Any Network)"
          : "📱 Share Link or Scan QR to Join";

      const ipRow = document.getElementById("share-ip-row");
      const ipSel = document.getElementById("share-ip-select");
      if (routes.length > 1) {
        ipRow.classList.remove("hidden");
        ipSel.innerHTML = routes
          .map((r, i) => '<option value="' + i + '"' + (i === selectedRouteIdx ? " selected" : "") + ">" + escapeHtml(r.label + " — " + r.url) + "</option>")
          .join("");
      } else {
        ipRow.classList.add("hidden");
      }
    }

    function openQrModalFor(roomId = null) {
      const routes = getAllRoutes();
      if (selectedRouteIdx >= routes.length) selectedRouteIdx = 0;

      const url = getJoinUrl(roomId);
      document.getElementById("qr-modal-title").textContent = roomId ? "📱 Share or Scan Room " + roomId : "📱 Share or Scan Chess Link";
      renderQrToCanvas(document.getElementById("qr-modal-canvas"), url, 210);
      document.getElementById("qr-modal-url").textContent = url;

      const pinBox = document.getElementById("qr-modal-pin-box");
      if (currentGame && currentGame.hostPin) {
        pinBox.classList.remove("hidden");
        document.getElementById("qr-modal-pin-digits").textContent = currentGame.hostPin;
      } else {
        pinBox.classList.add("hidden");
      }

      const ipRow = document.getElementById("qr-modal-ip-row");
      const ipSel = document.getElementById("qr-modal-ip-select");
      if (routes.length > 1) {
        ipRow.classList.remove("hidden");
        ipSel.innerHTML = routes
          .map((r, i) => '<option value="' + i + '"' + (i === selectedRouteIdx ? " selected" : "") + ">" + escapeHtml(r.label + " — " + r.url) + "</option>")
          .join("");
      } else {
        ipRow.classList.add("hidden");
      }
      qrModal.classList.remove("hidden");
    }

    document.getElementById("share-ip-select").addEventListener("change", (e) => {
      selectedRouteIdx = Number(e.target.value) || 0;
      updateShareQr();
      updateLobbyQr();
    });

    document.getElementById("qr-modal-ip-select").addEventListener("change", (e) => {
      selectedRouteIdx = Number(e.target.value) || 0;
      openQrModalFor(currentGame ? currentGame.roomId : null);
      updateLobbyQr();
      if (currentGame) updateShareQr();
    });

    fetch("/api/info")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.lanEntries) && data.lanEntries.length) lanEntries = data.lanEntries;
        if (data.tunnel) tunnelState = data.tunnel;
        selectedRouteIdx = 0;
        renderLanUrls();
        updateTunnelUi();
        updateLobbyQr();
      })
      .catch(() => {
        renderLanUrls();
        updateLobbyQr();
      });

    function connectWs() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(proto + "//" + location.host + "/ws");

      ws.addEventListener("open", () => {
        connBadge.textContent = "Connected";
        connBadge.classList.remove("offline");
        ws.send(JSON.stringify({ type: "hello", clientId, name: nameInput.value.trim() || "Player" }));

        const params = new URLSearchParams(location.search);
        const roomParam = currentGame ? currentGame.roomId : params.get("room");
        if (roomParam) {
          ws.send(JSON.stringify({ type: "join_room", roomId: roomParam, name: nameInput.value.trim() || "Player" }));
        }
      });

      ws.addEventListener("close", () => {
        connBadge.textContent = "Reconnecting...";
        connBadge.classList.add("offline");
        setTimeout(connectWs, 1500);
      });

      ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "welcome") {
          clientId = msg.clientId;
          sessionStorage.setItem("bunChessClientId", clientId);
          if (Array.isArray(msg.lanEntries) && msg.lanEntries.length) lanEntries = msg.lanEntries;
          if (msg.tunnel) tunnelState = msg.tunnel;
          selectedRouteIdx = 0;
          renderLanUrls();
          updateTunnelUi();
          updateLobbyQr();
          if (currentGame) updateShareQr();
        } else if (msg.type === "tunnel_status") {
          const wasActive = tunnelState.status === "active";
          tunnelState = msg.tunnel;
          if (!wasActive && tunnelState.status === "active") {
            selectedRouteIdx = 0;
            showToast("Direct online link ready: " + tunnelState.url);
          } else if (tunnelState.status === "error" && tunnelState.error) {
            showToast(tunnelState.error);
          }
          renderLanUrls();
          updateTunnelUi();
          updateLobbyQr();
          if (currentGame) updateShareQr();
          if (!qrModal.classList.contains("hidden")) openQrModalFor(currentGame ? currentGame.roomId : null);
        } else if (msg.type === "pin_required") {
          openPinPrompt(msg.roomId, msg.hostName, "");
        } else if (msg.type === "pin_error") {
          openPinPrompt(msg.roomId, msg.hostName, msg.message || "Incorrect PIN.");
        } else if (msg.type === "rooms_list") {
          renderRoomsList(msg.rooms || []);
        } else if (msg.type === "game_state") {
          pendingPinRoomId = null;
          pinModal.classList.add("hidden");
          handleGameState(msg);
        } else if (msg.type === "chat") {
          appendChat(msg);
        } else if (msg.type === "error") {
          showToast(msg.message);
        }
      });
    }

    function renderLanUrls() {
      const container = document.getElementById("lan-urls-container");
      const routes = getAllRoutes();
      container.innerHTML = routes
        .map((r) => '<span class="lan-url-pill">' + escapeHtml(r.url) + ' <button class="small" data-copy="' + escapeHtml(r.url) + '" style="padding:2px 6px;font-size:0.75rem;">Copy</button></span>')
        .join("");
      container.querySelectorAll("button[data-copy]").forEach((btn) => {
        btn.addEventListener("click", () => {
          copyText(btn.dataset.copy);
          showToast("Copied URL!");
        });
      });
    }

    function renderRoomsList(rooms) {
      const el = document.getElementById("rooms-list");
      if (!rooms.length) {
        el.innerHTML = '<div class="room-meta">No open rooms right now.</div>';
        return;
      }
      el.innerHTML = rooms
        .map((r) => {
          const tc = r.timeControl ? Math.floor(r.timeControl / 60) + "+" + r.increment : "Unlimited";
          const label = r.status === "waiting" ? ("🔒 Join as " + r.openColor) : "🔒 Spectate";
          return '<div class="room-item"><div><div><span class="room-code">' + r.roomId + '</span> — ' + escapeHtml(r.hostName) + '</div><div class="room-meta">' + tc + ' • ' + r.playersCount + '/2 players • PIN required</div></div><button class="small primary" data-join="' + r.roomId + '">' + label + '</button></div>';
        })
        .join("");
      el.querySelectorAll("button[data-join]").forEach((btn) => {
        btn.addEventListener("click", () => {
          sendWs({ type: "join_room", roomId: btn.dataset.join, name: nameInput.value.trim() || "Player" });
        });
      });
    }

    function isMyTurnNow(g) {
      if (!g || g.status !== "playing") return false;
      return g.yourColor === "both" || g.yourColor === g.state.turn;
    }

    function handleGameState(game) {
      const isNewRoom = !currentGame || currentGame.roomId !== game.roomId;
      const oldColor = currentGame ? currentGame.yourColor : null;
      currentGame = game;

      lobbyView.classList.add("hidden");
      gameView.classList.remove("hidden");
      resetResignConfirm();

      if (isNewRoom || oldColor !== game.yourColor) {
        boardFlipped = game.yourColor === "b";
      }

      if (isNewRoom) {
        selectedSq = null;
        viewPly = null;
        lastMoveCount = game.state.history.length;
        lastStatus = game.status;
        chatLog.innerHTML = "";
        gameOverModal.classList.add("hidden");
        qrModal.classList.add("hidden");
        const url = new URL(location.href);
        url.searchParams.set("room", game.roomId);
        history.replaceState(null, "", url.toString());
      } else {
        viewPly = null;
        if (game.state.history.length > lastMoveCount) {
          const last = game.state.history[game.state.history.length - 1];
          const status = getGameStatus(game.state);
          if (status.over) playSound("end");
          else if (status.inCheck) playSound("check");
          else if (last.capture) playSound("capture");
          else playSound("move");

          if (game.mode === "local" && game.localAutoFlip && game.status === "playing") {
            boardFlipped = game.state.turn === "b";
          }
        } else if (game.status === "finished" && lastStatus !== "finished") {
          playSound("end");
        }
        if (game.status === "playing" && lastStatus === "finished") {
          gameOverModal.classList.add("hidden");
          if (game.yourColor === "w" || game.yourColor === "b") {
            boardFlipped = game.yourColor === "b";
          }
        }
      }

      if (game.status === "finished" && lastStatus !== "finished") {
        showGameOverModal(game);
      }

      lastMoveCount = game.state.history.length;
      lastStatus = game.status;
      selectedSq = null;
      legalMovesCache = isMyTurnNow(game) ? generateLegalMoves(game.state) : [];

      renderBoard();
      renderSidebarAndBars();
      startClockInterpolation();
    }

    function showGameOverModal(g) {
      const titleEl = document.getElementById("gameover-title");
      const subEl = document.getElementById("gameover-sub");
      if (g.winner === "draw") {
        titleEl.textContent = "Game Drawn";
      } else {
        titleEl.textContent = (g.winner === "w" ? "White" : "Black") + " Wins!";
      }
      subEl.textContent = (g.reason || g.result || "").toUpperCase() + " • " + g.state.history.length + " half-moves played";
      const isPlayer = g.yourColor === "w" || g.yourColor === "b" || g.yourColor === "both";
      document.getElementById("gameover-rematch-btn").classList.toggle("hidden", !isPlayer);
      gameOverModal.classList.remove("hidden");
    }

    function formatClock(ms) {
      const totalSec = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }

    function startClockInterpolation() {
      clearInterval(localClockInterval);
      if (!currentGame || !currentGame.clocks.enabled) return;

      const syncAt = Date.now();
      const baseW = currentGame.clocks.w;
      const baseB = currentGame.clocks.b;

      const updateClocksUI = () => {
        if (!currentGame) return;
        const topColor = boardFlipped ? "w" : "b";
        const bottomColor = boardFlipped ? "b" : "w";

        let wMs = baseW;
        let bMs = baseB;
        if (currentGame.status === "playing" && currentGame.state.history.length > 0) {
          const elapsed = Date.now() - syncAt;
          if (currentGame.state.turn === "w") wMs = Math.max(0, baseW - elapsed);
          else bMs = Math.max(0, baseB - elapsed);
        }

        const topMs = topColor === "w" ? wMs : bMs;
        const bottomMs = bottomColor === "w" ? wMs : bMs;
        const topClock = document.getElementById("top-clock");
        const bottomClock = document.getElementById("bottom-clock");
        topClock.textContent = formatClock(topMs);
        bottomClock.textContent = formatClock(bottomMs);
        topClock.classList.toggle("low", topMs < 20000);
        bottomClock.classList.toggle("low", bottomMs < 20000);
      };

      updateClocksUI();
      if (currentGame.status === "playing" && currentGame.state.history.length > 0) {
        localClockInterval = setInterval(updateClocksUI, 250);
      }
    }

    function getDisplayedState() {
      const g = currentGame;
      if (viewPly === null || viewPly >= g.state.history.length) {
        return { state: g.state, lastMove: g.lastMove, historySlice: g.state.history, isHistorical: false };
      }
      if (viewPly <= 0) {
        return { state: fenToState(g.state.initialFen), lastMove: null, historySlice: [], isHistorical: true };
      }
      const moveRec = g.state.history[viewPly - 1];
      return { state: fenToState(moveRec.fen), lastMove: moveRec, historySlice: g.state.history.slice(0, viewPly), isHistorical: true };
    }

    function renderSidebarAndBars() {
      const g = currentGame;
      const disp = getDisplayedState();
      const topColor = boardFlipped ? "w" : "b";
      const bottomColor = boardFlipped ? "b" : "w";
      const topP = g.players[topColor];
      const bottomP = g.players[bottomColor];

      document.getElementById("top-name").textContent = topP.name + " (" + (topColor === "w" ? "White" : "Black") + ")";
      document.getElementById("bottom-name").textContent = bottomP.name + " (" + (bottomColor === "w" ? "White" : "Black") + ")";
      document.getElementById("top-dot").classList.toggle("off", !topP.connected);
      document.getElementById("bottom-dot").classList.toggle("off", !bottomP.connected);
      document.getElementById("top-player-bar").classList.toggle("active-turn", g.status === "playing" && g.state.turn === topColor);
      document.getElementById("bottom-player-bar").classList.toggle("active-turn", g.status === "playing" && g.state.turn === bottomColor);
      document.getElementById("top-clock").classList.toggle("hidden", !g.clocks.enabled);
      document.getElementById("bottom-clock").classList.toggle("hidden", !g.clocks.enabled);

      const mat = getCapturedAndMaterial(disp.state, disp.historySlice);
      const renderCap = (elId, color) => {
        const list = color === "w" ? mat.capturedByWhite : mat.capturedByBlack;
        const adv = color === "w" ? mat.advantage : -mat.advantage;
        const html = list.map((p) => '<span class="captured-mini">' + getPieceSvg(p) + '</span>').join("");
        document.getElementById(elId).innerHTML = html + (adv > 0 ? '<strong style="margin-left:4px;color:var(--accent);">+' + adv + '</strong>' : "");
      };
      renderCap("top-captured", topColor);
      renderCap("bottom-captured", bottomColor);

      const modeTag = g.mode === "lan" ? (tunnelState.status === "active" ? "ONLINE" : "LAN") : g.mode === "local" ? "2P" : "AI";
      document.getElementById("room-badge").textContent = modeTag + " • " + g.roomId;

      const statusTitle = document.getElementById("game-status-title");
      const engineStatus = getGameStatus(g.state);
      if (g.status === "waiting") {
        statusTitle.textContent = "Waiting for opponent...";
      } else if (g.status === "finished") {
        if (g.winner === "draw") statusTitle.textContent = "Draw (" + (g.reason || g.result) + ")";
        else statusTitle.textContent = (g.winner === "w" ? "White" : "Black") + " wins (" + (g.reason || g.result) + ")!";
      } else {
        const turnName = g.state.turn === "w" ? "White" : "Black";
        statusTitle.textContent = engineStatus.inCheck ? turnName + " is in CHECK!" : turnName + " to move";
      }

      const showShare = g.mode === "lan" && g.status === "waiting";
      document.getElementById("share-banner").classList.toggle("hidden", !showShare);
      document.getElementById("share-code").textContent = g.roomId;

      const pinBox = document.getElementById("share-pin-box");
      if (showShare && g.hostPin) {
        pinBox.classList.remove("hidden");
        document.getElementById("share-pin-digits").textContent = g.hostPin;
      } else {
        pinBox.classList.add("hidden");
      }

      if (showShare) updateShareQr();

      const canClaim = g.mode === "lan" && g.yourColor === "spectator" && (!g.players.w.connected || !g.players.b.connected);
      document.getElementById("reclaim-banner").classList.toggle("hidden", !canClaim);

      const showDrawBanner = g.status === "playing" && g.drawOfferBy && g.drawOfferBy !== g.yourColor && (g.yourColor === "w" || g.yourColor === "b");
      document.getElementById("draw-banner").classList.toggle("hidden", !showDrawBanner);
      document.getElementById("history-banner").classList.toggle("hidden", !disp.isHistorical);

      const isPlayer = g.yourColor === "w" || g.yourColor === "b" || g.yourColor === "both";
      document.getElementById("room-qr-btn").classList.toggle("hidden", g.mode !== "lan");
      document.getElementById("room-qr-btn").textContent = g.hostPin ? "📱 Share / PIN" : "📱 Share / QR";
      document.getElementById("undo-btn").classList.toggle("hidden", !((g.mode === "ai" || g.mode === "local") && g.status === "playing"));
      document.getElementById("undo-btn").disabled = !g.canUndo;
      document.getElementById("draw-btn").classList.toggle("hidden", !(g.mode === "lan" && g.status === "playing" && (g.yourColor === "w" || g.yourColor === "b")));
      document.getElementById("draw-btn").disabled = g.drawOfferBy === g.yourColor;
      document.getElementById("resign-btn").classList.toggle("hidden", !(g.status === "playing" && isPlayer));

      const rematchBtn = document.getElementById("rematch-btn");
      rematchBtn.classList.toggle("hidden", !(g.status === "finished" && isPlayer));
      const voted = g.rematchVotes.includes(g.yourColor);
      rematchBtn.textContent = voted ? "✓ Rematch Requested" : "↻ Rematch";
      rematchBtn.disabled = voted;

      chatBox.classList.toggle("hidden", g.mode !== "lan");

      const hist = g.state.history;
      const activePly = viewPly === null ? hist.length : viewPly;
      let moveHtml = "";
      for (let i = 0; i < hist.length; i += 2) {
        const num = Math.floor(i / 2) + 1;
        const wCell = hist[i]
          ? '<span class="move-cell ' + (activePly === i + 1 ? "active-ply" : "") + '" data-ply="' + (i + 1) + '">' + hist[i].san + '</span>'
          : "<span></span>";
        const bCell = hist[i + 1]
          ? '<span class="move-cell ' + (activePly === i + 2 ? "active-ply" : "") + '" data-ply="' + (i + 2) + '">' + hist[i + 1].san + '</span>'
          : "<span></span>";
        moveHtml += '<div class="move-row"><span class="move-num">' + num + '.</span>' + wCell + bCell + '</div>';
      }
      movesScroll.innerHTML = moveHtml || '<div class="room-meta">No moves yet.</div>';
      movesScroll.querySelectorAll(".move-cell").forEach((el) => {
        el.addEventListener("click", () => {
          const ply = Number(el.dataset.ply);
          setHistoryPly(ply === hist.length ? null : ply);
        });
      });
      if (!disp.isHistorical) movesScroll.scrollTop = movesScroll.scrollHeight;
    }

    function setHistoryPly(ply) {
      if (!currentGame) return;
      const total = currentGame.state.history.length;
      if (ply === null || ply >= total) viewPly = null;
      else if (ply <= 0) viewPly = 0;
      else viewPly = ply;
      selectedSq = null;
      renderBoard();
      renderSidebarAndBars();
    }

    function renderBoard() {
      const g = currentGame;
      const disp = getDisplayedState();
      const { board } = disp.state;
      const last = disp.lastMove;
      const status = getGameStatus(disp.state);
      const checkedKingSq = status.inCheck ? findKing(board, disp.state.turn) : -1;
      const interactive = !disp.isHistorical && isMyTurnNow(g);
      const legalTargets = interactive && selectedSq !== null ? legalMovesCache.filter((m) => m.from === selectedSq) : [];

      boardGrid.innerHTML = "";

      for (let vr = 0; vr < 8; vr++) {
        for (let vc = 0; vc < 8; vc++) {
          const r = boardFlipped ? 7 - vr : vr;
          const c = boardFlipped ? 7 - vc : vc;
          const sq = r * 8 + c;
          const isLight = ((r + c) & 1) === 0;

          const sqEl = document.createElement("div");
          sqEl.className = "square " + (isLight ? "light" : "dark");
          sqEl.dataset.sq = String(sq);

          if (last && (sq === last.from || sq === last.to)) sqEl.classList.add("last-move");
          if (sq === selectedSq) sqEl.classList.add("selected");
          if (sq === checkedKingSq) sqEl.classList.add("in-check");

          if (settings.coords) {
            if (vc === 0) {
              const rankLbl = document.createElement("span");
              rankLbl.className = "coord-rank";
              rankLbl.textContent = String(8 - r);
              sqEl.appendChild(rankLbl);
            }
            if (vr === 7) {
              const fileLbl = document.createElement("span");
              fileLbl.className = "coord-file";
              fileLbl.textContent = FILES[c];
              sqEl.appendChild(fileLbl);
            }
          }

          if (settings.hints) {
            const targetMove = legalTargets.find((m) => m.to === sq);
            if (targetMove) {
              const marker = document.createElement("div");
              marker.className = board[sq] || targetMove.enPassant ? "legal-ring" : "legal-dot";
              sqEl.appendChild(marker);
            }
          }

          const piece = board[sq];
          if (piece) {
            const pEl = document.createElement("div");
            pEl.className = "piece-el";
            pEl.innerHTML = getPieceSvg(piece);

            const activeTurnColor = g.state.turn;
            const canDrag = interactive && pieceColor(piece) === activeTurnColor;
            pEl.draggable = canDrag;
            if (canDrag) {
              pEl.addEventListener("dragstart", (e) => {
                dragFromSq = sq;
                selectedSq = sq;
                setTimeout(() => highlightSelectionOnly(), 0);
                e.dataTransfer?.setData("text/plain", String(sq));
              });
              pEl.addEventListener("dragend", () => {
                dragFromSq = null;
              });
            }
            sqEl.appendChild(pEl);
          }

          sqEl.addEventListener("dragover", (e) => e.preventDefault());
          sqEl.addEventListener("drop", (e) => {
            e.preventDefault();
            if (interactive && dragFromSq !== null && dragFromSq !== sq) {
              tryMove(dragFromSq, sq);
            }
            dragFromSq = null;
          });

          sqEl.addEventListener("click", () => handleSquareClick(sq));
          boardGrid.appendChild(sqEl);
        }
      }
    }

    function highlightSelectionOnly() {
      const squares = boardGrid.querySelectorAll(".square");
      const legalTargets = selectedSq !== null ? legalMovesCache.filter((m) => m.from === selectedSq) : [];
      squares.forEach((sqEl) => {
        const sq = Number(sqEl.dataset.sq);
        sqEl.classList.toggle("selected", sq === selectedSq);
        sqEl.querySelectorAll(".legal-dot, .legal-ring").forEach((x) => x.remove());
        if (settings.hints) {
          const targetMove = legalTargets.find((m) => m.to === sq);
          if (targetMove) {
            const marker = document.createElement("div");
            marker.className = currentGame.state.board[sq] || targetMove.enPassant ? "legal-ring" : "legal-dot";
            sqEl.appendChild(marker);
          }
        }
      });
    }

    function handleSquareClick(sq) {
      const g = currentGame;
      if (!g || viewPly !== null || !isMyTurnNow(g)) return;

      if (selectedSq !== null) {
        if (selectedSq === sq) {
          selectedSq = null;
          renderBoard();
          return;
        }
        if (tryMove(selectedSq, sq)) return;
      }

      const piece = g.state.board[sq];
      if (piece && pieceColor(piece) === g.state.turn) {
        selectedSq = sq;
        renderBoard();
      } else {
        selectedSq = null;
        renderBoard();
      }
    }

    function tryMove(from, to) {
      const matching = legalMovesCache.filter((m) => m.from === from && m.to === to);
      if (matching.length === 0) return false;

      if (matching.some((m) => m.promotion)) {
        if (settings.autoQueen) {
          sendWs({ type: "move", from, to, promotion: "q" });
          selectedSq = null;
          return true;
        }
        openPromotionModal(from, to);
        return true;
      }

      sendWs({ type: "move", from, to });
      selectedSq = null;
      return true;
    }

    function openPromotionModal(from, to) {
      pendingPromotion = { from, to };
      const isWhite = currentGame.state.turn === "w";
      promoChoices.innerHTML = ["q", "r", "b", "n"]
        .map((t) => '<button class="promo-btn" data-promo="' + t + '">' + getPieceSvg(isWhite ? t.toUpperCase() : t) + '</button>')
        .join("");

      promoChoices.querySelectorAll("button[data-promo]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const promo = btn.dataset.promo;
          promoModal.classList.add("hidden");
          if (pendingPromotion) {
            sendWs({ type: "move", from: pendingPromotion.from, to: pendingPromotion.to, promotion: promo });
            pendingPromotion = null;
            selectedSq = null;
          }
        });
      });
      promoModal.classList.remove("hidden");
    }

    function appendChat(msg) {
      const div = document.createElement("div");
      div.innerHTML = "<strong>" + escapeHtml(msg.sender) + ":</strong> " + escapeHtml(msg.text);
      chatLog.appendChild(div);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    function getCustomFenOrNull() {
      const val = document.getElementById("custom-fen-input").value.trim();
      if (!val) return null;
      if (!fenToState(val)) {
        showToast("Invalid FEN string! Check formatting.");
        return false;
      }
      return val;
    }

    function resetResignConfirm() {
      resignArmed = false;
      clearTimeout(resignTimer);
      document.getElementById("resign-btn").textContent = "🏳 Resign";
    }

    document.getElementById("clear-fen-btn").addEventListener("click", () => {
      document.getElementById("custom-fen-input").value = "";
    });

    document.getElementById("start-ai-btn").addEventListener("click", () => {
      const fen = getCustomFenOrNull();
      if (fen === false) return;
      const [tc, inc] = document.getElementById("ai-tc").value.split("|").map(Number);
      sendWs({
        type: "create_game",
        mode: "ai",
        difficulty: document.getElementById("ai-diff").value,
        color: document.getElementById("ai-color").value,
        timeControl: tc,
        increment: inc,
        customFen: fen,
        name: nameInput.value.trim() || "Player",
      });
    });

    document.getElementById("host-lan-btn").addEventListener("click", () => {
      const fen = getCustomFenOrNull();
      if (fen === false) return;
      const [tc, inc] = document.getElementById("lan-tc").value.split("|").map(Number);
      sendWs({
        type: "create_game",
        mode: "lan",
        color: document.getElementById("lan-color").value,
        timeControl: tc,
        increment: inc,
        isPrivate: document.getElementById("lan-private").checked,
        customFen: fen,
        name: nameInput.value.trim() || "Player",
      });
    });

    document.getElementById("start-local-btn").addEventListener("click", () => {
      const fen = getCustomFenOrNull();
      if (fen === false) return;
      const [tc, inc] = document.getElementById("local-tc").value.split("|").map(Number);
      sendWs({
        type: "create_game",
        mode: "local",
        timeControl: tc,
        increment: inc,
        localAutoFlip: document.getElementById("local-autoflip").checked,
        customFen: fen,
        name: nameInput.value.trim() || "Player",
      });
    });

    function joinByCodeInput() {
      const code = document.getElementById("join-code-input").value.trim().toUpperCase();
      if (!code) return showToast("Enter a 4-character room code.");
      sendWs({ type: "join_room", roomId: code, name: nameInput.value.trim() || "Player" });
    }
    document.getElementById("join-code-btn").addEventListener("click", joinByCodeInput);
    document.getElementById("join-code-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinByCodeInput();
    });

    document.getElementById("lobby-qr-btn").addEventListener("click", () => {
      openQrModalFor(currentGame ? currentGame.roomId : null);
    });
    document.getElementById("room-qr-btn").addEventListener("click", () => {
      openQrModalFor(currentGame ? currentGame.roomId : null);
    });
    document.getElementById("qr-modal-copy-btn").addEventListener("click", () => {
      const url = getJoinUrl(currentGame ? currentGame.roomId : null);
      copyText(url);
      showToast("Copied: " + url);
    });
    document.getElementById("close-qr-modal-btn").addEventListener("click", () => {
      qrModal.classList.add("hidden");
    });

    document.getElementById("claim-seat-btn").addEventListener("click", () => {
      sendWs({ type: "claim_seat", name: nameInput.value.trim() || "Player" });
    });

    document.getElementById("flip-btn").addEventListener("click", () => {
      boardFlipped = !boardFlipped;
      renderBoard();
      renderSidebarAndBars();
      startClockInterpolation();
    });

    document.getElementById("undo-btn").addEventListener("click", () => sendWs({ type: "undo" }));
    document.getElementById("draw-btn").addEventListener("click", () => {
      sendWs({ type: "offer_draw" });
      showToast("Draw offer sent.");
    });
    document.getElementById("accept-draw-btn").addEventListener("click", () => sendWs({ type: "respond_draw", accept: true }));
    document.getElementById("decline-draw-btn").addEventListener("click", () => sendWs({ type: "respond_draw", accept: false }));

    document.getElementById("resign-btn").addEventListener("click", (e) => {
      if (!resignArmed) {
        resignArmed = true;
        e.target.textContent = "Confirm Resign?";
        resignTimer = setTimeout(resetResignConfirm, 3000);
        return;
      }
      resetResignConfirm();
      sendWs({ type: "resign" });
    });

    document.getElementById("rematch-btn").addEventListener("click", () => sendWs({ type: "request_rematch" }));
    document.getElementById("gameover-rematch-btn").addEventListener("click", () => sendWs({ type: "request_rematch" }));
    document.getElementById("gameover-review-btn").addEventListener("click", () => gameOverModal.classList.add("hidden"));

    function returnToLobby() {
      clearInterval(localClockInterval);
      currentGame = null;
      viewPly = null;
      gameOverModal.classList.add("hidden");
      qrModal.classList.add("hidden");
      sendWs({ type: "leave_room" });
      gameView.classList.add("hidden");
      lobbyView.classList.remove("hidden");
      const url = new URL(location.href);
      url.searchParams.delete("room");
      history.replaceState(null, "", url.toString());
      updateLobbyQr();
    }

    document.getElementById("leave-btn").addEventListener("click", returnToLobby);
    document.getElementById("gameover-lobby-btn").addEventListener("click", returnToLobby);

    document.getElementById("copy-link-btn").addEventListener("click", () => {
      const link = getJoinUrl(currentGame.roomId);
      copyText(link);
      showToast("Copied: " + link);
    });

    document.getElementById("nav-first").addEventListener("click", () => setHistoryPly(0));
    document.getElementById("nav-prev").addEventListener("click", () => {
      const cur = viewPly === null ? currentGame.state.history.length : viewPly;
      setHistoryPly(cur - 1);
    });
    document.getElementById("nav-next").addEventListener("click", () => {
      if (viewPly === null) return;
      setHistoryPly(viewPly + 1);
    });
    document.getElementById("nav-last").addEventListener("click", () => setHistoryPly(null));
    document.getElementById("jump-live-btn").addEventListener("click", () => setHistoryPly(null));

    document.getElementById("copy-fen-btn").addEventListener("click", () => {
      if (!currentGame) return;
      const disp = getDisplayedState();
      copyText(stateToFen(disp.state));
      showToast("Copied FEN to clipboard!");
    });

    document.getElementById("copy-pgn-btn").addEventListener("click", () => {
      if (!currentGame) return;
      const g = currentGame;
      const hist = g.state.history;
      const nl = String.fromCharCode(10);
      const resTag = g.status === "finished" ? (g.winner === "w" ? "1-0" : g.winner === "b" ? "0-1" : "1/2-1/2") : "*";
      const moves = [];
      for (let i = 0; i < hist.length; i += 2) {
        const n = Math.floor(i / 2) + 1;
        moves.push(n + ". " + hist[i].san + (hist[i + 1] ? " " + hist[i + 1].san : ""));
      }
      const pgn =
        '[Event "Bun Chess ' + g.mode.toUpperCase() + '"]' + nl +
        '[White "' + g.players.w.name + '"]' + nl +
        '[Black "' + g.players.b.name + '"]' + nl +
        '[Result "' + resTag + '"]' + nl + nl +
        moves.join(" ") + (moves.length ? " " : "") + resTag;
      copyText(pgn);
      showToast("Copied PGN to clipboard!");
    });

    document.getElementById("chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("chat-input");
      const text = input.value.trim();
      if (!text) return;
      sendWs({ type: "chat", text });
      input.value = "";
    });

    document.getElementById("settings-btn").addEventListener("click", () => {
      document.getElementById("settings-modal").classList.remove("hidden");
    });
    document.getElementById("close-settings-btn").addEventListener("click", () => {
      document.getElementById("settings-modal").classList.add("hidden");
    });
    document.getElementById("help-btn").addEventListener("click", () => {
      document.getElementById("help-modal").classList.remove("hidden");
    });
    document.getElementById("close-help-btn").addEventListener("click", () => {
      document.getElementById("help-modal").classList.add("hidden");
    });

    ["opt-theme", "opt-sound", "opt-hints", "opt-coords", "opt-autoqueen"].forEach((id) => {
      document.getElementById(id).addEventListener("change", () => {
        settings.theme = document.getElementById("opt-theme").value;
        settings.sound = document.getElementById("opt-sound").checked;
        settings.hints = document.getElementById("opt-hints").checked;
        settings.coords = document.getElementById("opt-coords").checked;
        settings.autoQueen = document.getElementById("opt-autoqueen").checked;
        applySettings();
      });
    });

    window.addEventListener("keydown", (e) => {
      if (!currentGame) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "f" || e.key === "F") {
        boardFlipped = !boardFlipped;
        renderBoard();
        renderSidebarAndBars();
        startClockInterpolation();
      } else if (e.key === "ArrowLeft") {
        const cur = viewPly === null ? currentGame.state.history.length : viewPly;
        setHistoryPly(cur - 1);
      } else if (e.key === "ArrowRight") {
        if (viewPly !== null) setHistoryPly(viewPly + 1);
      } else if (e.key === "Home") {
        setHistoryPly(0);
      } else if (e.key === "End") {
        setHistoryPly(null);
      }
    });

    applySettings();
    updateTunnelUi();
    updateLobbyQr();
    connectWs();
  </script>
</body>
</html>`;

// ============================================================================
// 3. CROSS-PLATFORM BUN SERVER + CLOUDFLARE QUICK TUNNEL (NO SIGN-IN) + PIN
// ============================================================================
const args = process.argv.slice(2);
let explicitPort = false;
let preferredPort = parseInt(process.env.PORT || "3000", 10);
const shouldOpen = !args.includes("--no-open");
const lanOnly = args.includes("--lan-only");
let customPublicUrl = process.env.PUBLIC_URL || null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    preferredPort = parseInt(args[i + 1], 10) || 3000;
    explicitPort = true;
  } else if (args[i].startsWith("--port=")) {
    preferredPort = parseInt(args[i].split("=")[1], 10) || 3000;
    explicitPort = true;
  } else if (args[i] === "--public-url" && args[i + 1]) {
    customPublicUrl = args[i + 1].replace(/\/+$/, "");
  } else if (args[i].startsWith("--public-url=")) {
    customPublicUrl = args[i].split("=")[1].replace(/\/+$/, "");
  }
}

function getLanIPv4Addresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const isV4 = net.family === "IPv4" || net.family === 4;
      if (isV4 && !net.internal && !net.address.startsWith("169.254.")) {
        let priority = 10;
        if (/vethernet|wsl|docker|vbox|vmware|vmnet|tailscale|zerotier|tun|tap/i.test(name)) {
          priority += 100;
        }
        if (/wi-?fi|wlan|en0|en1|eth|ethernet/i.test(name)) {
          priority -= 10;
        }
        if (net.address.startsWith("192.168.")) priority += 0;
        else if (net.address.startsWith("10.")) priority += 2;
        else priority += 5;

        ips.push({ iface: name, address: net.address, priority });
      }
    }
  }
  ips.sort((a, b) => a.priority - b.priority);
  return ips;
}

function openBrowserCrossPlatform(url) {
  try {
    if (process.platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", "", url], { stdout: "ignore", stderr: "ignore" });
    } else if (process.platform === "darwin") {
      Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
    } else {
      Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" });
    }
  } catch {}
}

let tunnelProc = null;
let tunnelStatus = customPublicUrl
  ? { status: "active", url: customPublicUrl, provider: "Custom", message: null, error: null }
  : { status: "idle", url: null, provider: null, message: null, error: null };

function broadcastTunnelStatus() {
  const payload = JSON.stringify({ type: "tunnel_status", tunnel: tunnelStatus });
  for (const ws of clients.keys()) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

function stopPublicTunnel() {
  if (tunnelProc) {
    try { tunnelProc.kill(); } catch {}
    tunnelProc = null;
  }
  if (customPublicUrl) {
    tunnelStatus = { status: "active", url: customPublicUrl, provider: "Custom", message: null, error: null };
  } else {
    tunnelStatus = { status: "idle", url: null, provider: null, message: null, error: null };
  }
  broadcastTunnelStatus();
}

function readStreamChunks(stream, onText) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) onText(decoder.decode(value, { stream: true }));
      }
    } catch {}
  })();
}

function getCloudflaredAssetInfo() {
  const p = process.platform;
  const a = os.arch();
  if (p === "win32") {
    const file = a === "ia32" ? "cloudflared-windows-386.exe" : "cloudflared-windows-amd64.exe";
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`,
      binName: "cloudflared.exe",
      isTgz: false,
    };
  }
  if (p === "darwin") {
    const file = a === "arm64" ? "cloudflared-darwin-arm64.tgz" : "cloudflared-darwin-amd64.tgz";
    return {
      url: `https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`,
      binName: "cloudflared",
      isTgz: true,
    };
  }
  // Linux
  let file = "cloudflared-linux-amd64";
  if (a === "arm64") file = "cloudflared-linux-arm64";
  else if (a === "arm") file = "cloudflared-linux-arm";
  else if (a === "ia32") file = "cloudflared-linux-386";
  return {
    url: `https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`,
    binName: "cloudflared",
    isTgz: false,
  };
}

async function ensureCloudflaredBinary() {
  const existing = Bun.which("cloudflared");
  if (existing) return existing;

  const binDir = path.join(os.homedir(), ".bun-chess", "bin");
  const info = getCloudflaredAssetInfo();
  const binPath = path.join(binDir, info.binName);

  if (fs.existsSync(binPath)) {
    return binPath;
  }

  fs.mkdirSync(binDir, { recursive: true });
  tunnelStatus = {
    status: "starting",
    url: null,
    provider: null,
    message: "First-time setup: downloading Cloudflare tunnel helper (no sign-in required)...",
    error: null,
  };
  broadcastTunnelStatus();
  console.log("  ⬇ First-time setup: downloading official cloudflared binary...");

  const resp = await fetch(info.url, { redirect: "follow" });
  if (!resp.ok) {
    throw new Error(`Download failed (${resp.status})`);
  }

  if (info.isTgz) {
    const tgzPath = path.join(binDir, "cloudflared.tgz");
    await Bun.write(tgzPath, resp);
    const untar = Bun.spawn(["tar", "-xzf", tgzPath, "-C", binDir], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const code = await untar.exited;
    try { fs.unlinkSync(tgzPath); } catch {}
    if (code !== 0 || !fs.existsSync(binPath)) {
      throw new Error("Failed to extract cloudflared archive");
    }
  } else {
    await Bun.write(binPath, resp);
  }

  if (process.platform !== "win32") {
    fs.chmodSync(binPath, 0o755);
  }
  console.log("  ✓ cloudflared ready.");
  return binPath;
}

function spawnCloudflaredOnce(binPath, localPort, protocol) {
  return new Promise((resolve) => {
    const cmd = [binPath, "tunnel", "--no-autoupdate"];
    if (protocol) cmd.push("--protocol", protocol);
    cmd.push("--url", `http://127.0.0.1:${localPort}`);

    let proc;
    try {
      proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    } catch {
      return resolve(null);
    }

    let settled = false;
    const regex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { proc.kill(); } catch {}
        resolve(null);
      }
    }, 15000);

    const onChunk = (text) => {
      if (settled) return;
      const m = text.match(regex);
      if (m) {
        settled = true;
        clearTimeout(timer);
        resolve({ proc, url: m[0] });
      }
    };

    readStreamChunks(proc.stdout, onChunk);
    readStreamChunks(proc.stderr, onChunk);

    proc.exited.then(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      } else if (tunnelProc === proc && tunnelStatus.status === "active") {
        tunnelProc = null;
        tunnelStatus = {
          status: "error",
          url: null,
          provider: null,
          message: null,
          error: "Online tunnel disconnected.",
        };
        broadcastTunnelStatus();
      }
    });
  });
}

async function startPublicTunnel(localPort) {
  if (customPublicUrl) {
    tunnelStatus = { status: "active", url: customPublicUrl, provider: "Custom", message: null, error: null };
    broadcastTunnelStatus();
    return;
  }
  if (tunnelStatus.status === "active" || tunnelStatus.status === "starting") return;

  tunnelStatus = {
    status: "starting",
    url: null,
    provider: null,
    message: "Starting Cloudflare Quick Tunnel (no sign-in required)...",
    error: null,
  };
  broadcastTunnelStatus();

  let binPath;
  try {
    binPath = await ensureCloudflaredBinary();
  } catch (err) {
    tunnelStatus = {
      status: "error",
      url: null,
      provider: null,
      message: null,
      error: err?.message || "Could not prepare cloudflared",
    };
    broadcastTunnelStatus();
    return;
  }

  if (tunnelStatus.status !== "starting") return;

  tunnelStatus = {
    status: "starting",
    url: null,
    provider: null,
    message: "Connecting to Cloudflare edge...",
    error: null,
  };
  broadcastTunnelStatus();

  // Try http2 (TCP 443, works behind restrictive firewalls) then default quic
  let res = await spawnCloudflaredOnce(binPath, localPort, "http2");
  if (!res && tunnelStatus.status === "starting") {
    res = await spawnCloudflaredOnce(binPath, localPort, null);
  }

  if (res) {
    if (tunnelStatus.status !== "starting") {
      try { res.proc.kill(); } catch {}
      return;
    }
    tunnelProc = res.proc;
    tunnelStatus = {
      status: "active",
      url: res.url,
      provider: "Cloudflare",
      message: null,
      error: null,
    };
    console.log(`  🌍 Online (Direct, No Sign-In): ${res.url}`);
    broadcastTunnelStatus();
  } else if (tunnelStatus.status === "starting") {
    tunnelStatus = {
      status: "error",
      url: null,
      provider: null,
      message: null,
      error: "Could not reach Cloudflare (check internet connection)",
    };
    broadcastTunnelStatus();
  }
}

const rooms = new Map();
const clients = new Map();

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function generateFourDigitPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, "0");
}

function send(ws, payload) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  } catch {}
}

function getRoomPublicSummary(room) {
  const openSlot = !room.players.w.clientId ? "White" : !room.players.b.clientId ? "Black" : null;
  return {
    roomId: room.id,
    hostName: room.hostName,
    openColor: openSlot,
    timeControl: room.timeControl,
    increment: room.increment,
    status: room.status,
    playersCount: (room.players.w.clientId ? 1 : 0) + (room.players.b.clientId ? 1 : 0),
  };
}

function broadcastRoomsList() {
  const publicRooms = [];
  for (const room of rooms.values()) {
    if (room.mode === "lan" && !room.isPrivate && (room.status === "waiting" || room.status === "playing")) {
      publicRooms.push(getRoomPublicSummary(room));
    }
  }
  const payload = JSON.stringify({ type: "rooms_list", rooms: publicRooms });
  for (const [ws, info] of clients.entries()) {
    if (!info.roomId && ws.readyState === 1) ws.send(payload);
  }
}

function getClientColorInRoom(room, clientId) {
  if (room.mode === "local" && room.players.w.clientId === clientId) return "both";
  if (room.players.w.clientId === clientId) return "w";
  if (room.players.b.clientId === clientId) return "b";
  return "spectator";
}

function buildGameStatePayload(room, clientId) {
  const now = Date.now();
  const clocks = {
    enabled: room.timeControl > 0,
    w: room.clocks.w,
    b: room.clocks.b,
    increment: room.increment,
  };

  if (clocks.enabled && room.status === "playing" && room.clocks.lastTick !== null) {
    const elapsed = now - room.clocks.lastTick;
    clocks[room.state.turn] = Math.max(0, clocks[room.state.turn] - elapsed);
  }

  const canUndo =
    room.status === "playing" &&
    ((room.mode === "ai" && room.snapshots.length >= 2) ||
      (room.mode === "local" && room.snapshots.length >= 1));

  // SECURITY: Never send the 4-digit PIN to anyone except the host!
  const hostPin = room.mode === "lan" && room.hostClientId === clientId ? room.pin : null;

  return {
    type: "game_state",
    roomId: room.id,
    mode: room.mode,
    difficulty: room.difficulty,
    localAutoFlip: !!room.localAutoFlip,
    status: room.status,
    result: room.result,
    winner: room.winner,
    reason: room.reason,
    state: room.state,
    yourColor: getClientColorInRoom(room, clientId),
    hostPin,
    players: {
      w: {
        name: room.players.w.name,
        connected: room.players.w.isAI || room.players.w.sockets.size > 0,
        isAI: !!room.players.w.isAI,
      },
      b: {
        name: room.players.b.name,
        connected: room.players.b.isAI || room.players.b.sockets.size > 0,
        isAI: !!room.players.b.isAI,
      },
    },
    clocks,
    drawOfferBy: room.drawOfferBy,
    rematchVotes: Array.from(room.rematchVotes),
    canUndo,
    lastMove: room.state.history.length > 0 ? room.state.history[room.state.history.length - 1] : null,
  };
}

function broadcastRoomState(room) {
  for (const [ws, info] of clients.entries()) {
    if (info.roomId === room.id) send(ws, buildGameStatePayload(room, info.clientId));
  }
}

function broadcastRoomChat(room, msg) {
  const payload = JSON.stringify({ type: "chat", ...msg });
  for (const [ws, info] of clients.entries()) {
    if (info.roomId === room.id && ws.readyState === 1) ws.send(payload);
  }
}

function createRoom({ hostClientId, hostName, mode, colorPref, difficulty, timeControl, increment, localAutoFlip, customFen, isPrivate }) {
  const id = generateRoomCode();
  const initialState = Chess.createInitialState(customFen);
  const tcMs = (timeControl || 0) * 1000;
  const initStatus = Chess.getGameStatus(initialState);
  const pin = mode === "lan" ? generateFourDigitPin() : null;

  const room = {
    id,
    mode,
    pin,
    hostClientId,
    authorizedClients: new Set([hostClientId]),
    pinAttempts: new Map(),
    isPrivate: !!isPrivate,
    difficulty: difficulty || "medium",
    localAutoFlip: !!localAutoFlip,
    customFen: initialState.initialFen,
    hostName: hostName || "Player 1",
    timeControl: timeControl || 0,
    increment: increment || 0,
    status: mode === "lan" ? "waiting" : (initStatus.over ? "finished" : "playing"),
    result: mode !== "lan" && initStatus.over ? initStatus.result : null,
    winner: mode !== "lan" && initStatus.over ? initStatus.winner : null,
    reason: mode !== "lan" && initStatus.over ? initStatus.result : null,
    state: initialState,
    snapshots: [],
    players: {
      w: { clientId: null, name: "Waiting...", sockets: new Set(), isAI: false },
      b: { clientId: null, name: "Waiting...", sockets: new Set(), isAI: false },
    },
    clocks: { w: tcMs, b: tcMs, lastTick: null },
    drawOfferBy: null,
    rematchVotes: new Set(),
    aiTimer: null,
  };

  if (mode === "local") {
    room.players.w = { clientId: hostClientId, name: "White", sockets: new Set(), isAI: false };
    room.players.b = { clientId: hostClientId, name: "Black", sockets: new Set(), isAI: false };
  } else {
    let humanColor = colorPref;
    if (humanColor !== "w" && humanColor !== "b") humanColor = Math.random() < 0.5 ? "w" : "b";
    const oppColor = humanColor === "w" ? "b" : "w";

    room.players[humanColor] = { clientId: hostClientId, name: hostName || "Player 1", sockets: new Set(), isAI: false };

    if (mode === "ai") {
      const label = room.difficulty === "easy" ? "Casual" : room.difficulty === "hard" ? "Hard" : "Medium";
      room.players[oppColor] = { clientId: "AI", name: `Computer (${label})`, sockets: new Set(), isAI: true };
    }
  }

  rooms.set(id, room);
  return room;
}

function attachSocketToRoom(ws, info, room) {
  detachSocketFromRoom(ws, info);
  info.roomId = room.id;

  const color = getClientColorInRoom(room, info.clientId);
  if (color === "both") {
    room.players.w.sockets.add(ws);
    room.players.b.sockets.add(ws);
  } else if (color === "w" || color === "b") {
    room.players[color].sockets.add(ws);
  } else if (room.mode === "lan" && room.status === "waiting") {
    const openColor = !room.players.w.clientId ? "w" : !room.players.b.clientId ? "b" : null;
    if (openColor) {
      room.players[openColor].clientId = info.clientId;
      room.players[openColor].name = info.name || "Remote Player";
      room.players[openColor].sockets.add(ws);
      const initStatus = Chess.getGameStatus(room.state);
      if (initStatus.over) {
        room.status = "finished";
        room.result = initStatus.result;
        room.winner = initStatus.winner;
        room.reason = initStatus.result;
      } else {
        room.status = "playing";
      }
    }
  }

  broadcastRoomState(room);
  broadcastRoomsList();
}

function detachSocketFromRoom(ws, info) {
  if (!info.roomId) return;
  const room = rooms.get(info.roomId);
  info.roomId = null;
  if (!room) return;

  room.players.w.sockets.delete(ws);
  room.players.b.sockets.delete(ws);

  const wAlive = room.players.w.sockets.size > 0;
  const bAlive = room.players.b.sockets.size > 0;
  let anySpectator = false;
  for (const other of clients.values()) {
    if (other.roomId === room.id) {
      anySpectator = true;
      break;
    }
  }

  if (!wAlive && !bAlive && !anySpectator) {
    if (room.aiTimer) clearTimeout(room.aiTimer);
    rooms.delete(room.id);
  } else {
    broadcastRoomState(room);
  }
  broadcastRoomsList();
}

function scheduleAIMoveIfNeeded(room) {
  if (room.mode !== "ai" || room.status !== "playing") return;
  if (!room.players[room.state.turn].isAI) return;

  if (room.aiTimer) clearTimeout(room.aiTimer);
  room.aiTimer = setTimeout(() => {
    room.aiTimer = null;
    if (!rooms.has(room.id) || room.status !== "playing") return;
    if (!room.players[room.state.turn].isAI) return;

    const aiMove = Chess.chooseAIMove(room.state, room.difficulty);
    if (!aiMove) return;
    applyValidatedMove(room, aiMove);
  }, 160);
}

function applyValidatedMove(room, moveInput) {
  const now = Date.now();
  const moverColor = room.state.turn;

  if (room.timeControl > 0 && room.clocks.lastTick !== null) {
    const elapsed = now - room.clocks.lastTick;
    room.clocks[moverColor] = Math.max(0, room.clocks[moverColor] - elapsed);
    if (room.clocks[moverColor] <= 0) {
      room.status = "finished";
      room.result = "timeout";
      room.winner = moverColor === "w" ? "b" : "w";
      room.reason = `${moverColor === "w" ? "White" : "Black"} ran out of time`;
      broadcastRoomState(room);
      return true;
    }
    room.clocks[moverColor] += room.increment * 1000;
  }

  const prevSnapshot = (room.mode === "ai" || room.mode === "local") ? Chess.cloneState(room.state, true) : null;
  const res = Chess.makeMove(room.state, moveInput);
  if (!res) return false;

  if (prevSnapshot) room.snapshots.push(prevSnapshot);

  room.state = res.state;
  room.drawOfferBy = null;
  if (room.timeControl > 0) room.clocks.lastTick = now;

  const status = Chess.getGameStatus(room.state);
  if (status.over) {
    room.status = "finished";
    room.result = status.result;
    room.winner = status.winner;
    room.reason = status.result;
    room.clocks.lastTick = null;
  }

  broadcastRoomState(room);
  if (!status.over) scheduleAIMoveIfNeeded(room);
  return true;
}

function resetRoomForRematch(room) {
  if (room.aiTimer) clearTimeout(room.aiTimer);
  room.state = Chess.createInitialState(room.customFen);
  room.snapshots = [];
  room.status = "playing";
  room.result = null;
  room.winner = null;
  room.reason = null;
  room.drawOfferBy = null;
  room.rematchVotes.clear();
  room.clocks = { w: room.timeControl * 1000, b: room.timeControl * 1000, lastTick: null };

  if (room.mode !== "local") {
    const oldW = room.players.w;
    room.players.w = room.players.b;
    room.players.b = oldW;
  }

  broadcastRoomState(room);
  scheduleAIMoveIfNeeded(room);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.timeControl > 0 && room.status === "playing" && room.clocks.lastTick !== null) {
      const turn = room.state.turn;
      const elapsed = now - room.clocks.lastTick;
      if (room.clocks[turn] - elapsed <= 0) {
        room.clocks[turn] = 0;
        room.clocks.lastTick = null;
        room.status = "finished";
        room.result = "timeout";
        room.winner = turn === "w" ? "b" : "w";
        room.reason = `${turn === "w" ? "White" : "Black"} ran out of time`;
        broadcastRoomState(room);
      }
    }
  }
}, 500);

function startBunServer(portToTry) {
  return Bun.serve({
    hostname: "0.0.0.0",
    port: portToTry,
    fetch(req, serverInstance) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        if (serverInstance.upgrade(req)) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      if (url.pathname === "/engine.js") {
        return new Response(ENGINE_MODULE_SOURCE, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }
      if (url.pathname === "/api/info") {
        return Response.json({
          port: serverInstance.port,
          lanEntries: getLanIPv4Addresses().map((x) => ({
            iface: x.iface,
            url: `http://${x.address}:${serverInstance.port}`,
          })),
          tunnel: tunnelStatus,
          rooms: rooms.size,
        });
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(HTML_PAGE, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },

    websocket: {
      open(ws) {
        clients.set(ws, { clientId: crypto.randomUUID(), name: "Player", roomId: null });
      },

      message(ws, raw) {
        let msg;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
        } catch {
          return;
        }

        const info = clients.get(ws);
        if (!info) return;

        if (msg.type === "hello") {
          if (typeof msg.clientId === "string" && msg.clientId.length >= 8) info.clientId = msg.clientId;
          if (typeof msg.name === "string" && msg.name.trim()) info.name = msg.name.trim().slice(0, 20);
          send(ws, {
            type: "welcome",
            clientId: info.clientId,
            lanEntries: getLanIPv4Addresses().map((x) => ({
              iface: x.iface,
              url: `http://${x.address}:${server.port}`,
            })),
            tunnel: tunnelStatus,
            port: server.port,
          });
          broadcastRoomsList();
          return;
        }

        if (msg.type === "start_tunnel") {
          startPublicTunnel(server.port);
          return;
        }

        if (msg.type === "stop_tunnel") {
          stopPublicTunnel();
          return;
        }

        if (msg.type === "create_game") {
          if (typeof msg.name === "string" && msg.name.trim()) info.name = msg.name.trim().slice(0, 20);
          const mode = msg.mode === "lan" ? "lan" : msg.mode === "local" ? "local" : "ai";
          const room = createRoom({
            hostClientId: info.clientId,
            hostName: info.name,
            mode,
            colorPref: msg.color || "random",
            difficulty: msg.difficulty || "medium",
            timeControl: Number(msg.timeControl) || 0,
            increment: Number(msg.increment) || 0,
            localAutoFlip: msg.localAutoFlip,
            isPrivate: msg.isPrivate,
            customFen: msg.customFen || null,
          });
          attachSocketToRoom(ws, info, room);
          scheduleAIMoveIfNeeded(room);
          return;
        }

        if (msg.type === "join_room") {
          if (typeof msg.name === "string" && msg.name.trim()) info.name = msg.name.trim().slice(0, 20);
          const code = String(msg.roomId || "").trim().toUpperCase();
          const room = rooms.get(code);
          if (!room) {
            send(ws, { type: "error", message: `Room "${code}" not found.` });
            return;
          }

          if (room.mode === "lan" && !room.authorizedClients.has(info.clientId)) {
            const now = Date.now();
            const tracker = room.pinAttempts.get(info.clientId) || { count: 0, lockedUntil: 0 };
            if (tracker.lockedUntil > now) {
              const waitSec = Math.ceil((tracker.lockedUntil - now) / 1000);
              send(ws, {
                type: "pin_error",
                roomId: room.id,
                hostName: room.hostName,
                message: `Too many wrong attempts. Wait ${waitSec}s and try again.`,
              });
              return;
            }

            const enteredPin = typeof msg.pin === "string" ? msg.pin.trim() : "";
            if (!enteredPin) {
              send(ws, { type: "pin_required", roomId: room.id, hostName: room.hostName });
              return;
            }

            if (enteredPin !== room.pin) {
              tracker.count += 1;
              if (tracker.count >= 5) {
                tracker.lockedUntil = now + 15000;
                tracker.count = 0;
              }
              room.pinAttempts.set(info.clientId, tracker);
              send(ws, {
                type: "pin_error",
                roomId: room.id,
                hostName: room.hostName,
                message: tracker.lockedUntil > now
                  ? "Too many wrong PIN attempts. Please wait 15 seconds."
                  : "Incorrect 4-digit PIN. Ask the host for the code on their screen.",
              });
              return;
            }

            room.pinAttempts.delete(info.clientId);
            room.authorizedClients.add(info.clientId);
          }

          const existingColor = getClientColorInRoom(room, info.clientId);
          if (existingColor === "w" || existingColor === "b") room.players[existingColor].name = info.name;
          attachSocketToRoom(ws, info, room);
          return;
        }

        if (msg.type === "leave_room") {
          detachSocketFromRoom(ws, info);
          return;
        }

        const room = info.roomId ? rooms.get(info.roomId) : null;
        if (!room) return;
        const myColor = getClientColorInRoom(room, info.clientId);

        if (msg.type === "claim_seat") {
          if (room.mode !== "lan" || myColor !== "spectator") return;
          if (!room.authorizedClients.has(info.clientId)) return;
          if (typeof msg.name === "string" && msg.name.trim()) info.name = msg.name.trim().slice(0, 20);
          const seatColor =
            room.players.w.sockets.size === 0 ? "w" :
            room.players.b.sockets.size === 0 ? "b" : null;
          if (seatColor) {
            room.players[seatColor].clientId = info.clientId;
            room.players[seatColor].name = info.name;
            room.players[seatColor].sockets.add(ws);
            broadcastRoomState(room);
          }
          return;
        }

        if (msg.type === "move") {
          if (room.status !== "playing") return;
          if (myColor !== "both" && myColor !== room.state.turn) return;
          applyValidatedMove(room, { from: msg.from, to: msg.to, promotion: msg.promotion });
          return;
        }

        if (msg.type === "undo") {
          if (room.status !== "playing") return;
          if (room.mode === "ai" && room.snapshots.length >= 2 && (myColor === "w" || myColor === "b")) {
            if (room.aiTimer) clearTimeout(room.aiTimer);
            room.snapshots.pop();
            room.state = room.snapshots.pop();
            broadcastRoomState(room);
          } else if (room.mode === "local" && room.snapshots.length >= 1 && myColor === "both") {
            room.state = room.snapshots.pop();
            broadcastRoomState(room);
          }
          return;
        }

        if (msg.type === "resign") {
          if (room.status !== "playing") return;
          if (myColor !== "w" && myColor !== "b" && myColor !== "both") return;
          if (room.aiTimer) clearTimeout(room.aiTimer);
          const loser = myColor === "both" ? room.state.turn : myColor;
          room.status = "finished";
          room.result = "resignation";
          room.winner = loser === "w" ? "b" : "w";
          room.reason = `${loser === "w" ? "White" : "Black"} resigned`;
          room.clocks.lastTick = null;
          broadcastRoomState(room);
          return;
        }

        if (msg.type === "offer_draw") {
          if (room.mode !== "lan" || room.status !== "playing") return;
          if (myColor !== "w" && myColor !== "b") return;
          room.drawOfferBy = myColor;
          broadcastRoomState(room);
          return;
        }

        if (msg.type === "respond_draw") {
          if (room.mode !== "lan" || room.status !== "playing") return;
          if (myColor !== "w" && myColor !== "b") return;
          if (!room.drawOfferBy || room.drawOfferBy === myColor) return;
          if (msg.accept) {
            room.status = "finished";
            room.result = "agreement";
            room.winner = "draw";
            room.reason = "Draw by mutual agreement";
            room.clocks.lastTick = null;
          }
          room.drawOfferBy = null;
          broadcastRoomState(room);
          return;
        }

        if (msg.type === "request_rematch") {
          if (room.status !== "finished") return;
          if (myColor === "spectator") return;
          if (room.mode === "ai" || room.mode === "local") {
            resetRoomForRematch(room);
            return;
          }
          room.rematchVotes.add(myColor);
          if (room.rematchVotes.has("w") && room.rematchVotes.has("b")) resetRoomForRematch(room);
          else broadcastRoomState(room);
          return;
        }

        if (msg.type === "chat") {
          if (typeof msg.text !== "string") return;
          const clean = msg.text.trim().slice(0, 200);
          if (!clean) return;
          broadcastRoomChat(room, { sender: info.name, color: myColor, text: clean, ts: Date.now() });
        }
      },

      close(ws) {
        const info = clients.get(ws);
        if (info) {
          detachSocketFromRoom(ws, info);
          clients.delete(ws);
        }
      },
    },
  });
}

let server = null;
const maxAttempts = explicitPort ? 1 : 10;
for (let attempt = 0; attempt < maxAttempts; attempt++) {
  try {
    server = startBunServer(preferredPort + attempt);
    break;
  } catch (err) {
    if (attempt === maxAttempts - 1) throw err;
  }
}

const cleanupAndExit = () => {
  if (tunnelProc) {
    try { tunnelProc.kill(); } catch {}
  }
  process.exit(0);
};
process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);

const localUrl = `http://localhost:${server.port}`;
const lanIps = getLanIPv4Addresses();

console.log("\n======================================================");
console.log("  ♟  Bun Chess Server Running (Cloudflare + LAN + PIN)");
console.log("======================================================");
console.log(`  OS       : ${process.platform} (${os.arch()})`);
console.log(`  Local    : ${localUrl}`);
if (lanIps.length > 0) {
  for (const item of lanIps) {
    console.log(`  LAN (${item.iface}): http://${item.address}:${server.port}`);
  }
} else {
  console.log("  LAN      : No external IPv4 interface detected");
}
if (customPublicUrl) {
  console.log(`  🌍 Online : ${customPublicUrl}`);
}
console.log("======================================================\n");

if (shouldOpen) {
  openBrowserCrossPlatform(localUrl);
}

// Automatically start seamless Cloudflare Quick Tunnel (unless --lan-only or --public-url)
if (!lanOnly && !customPublicUrl) {
  startPublicTunnel(server.port);
}
