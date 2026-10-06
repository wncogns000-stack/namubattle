// 대결 진행 규칙: 정답 도전, 결과 기록
//
// 정답 도전 기회 규칙
//   - 처음에는 두 사람 모두 언제든 '정답 도전'을 외칠 수 있어요.
//   - 도전해서 맞히면 바로 승리!
//   - 틀리면 다음 도전 기회는 상대에게 넘어가요. (틀린 사람은 상대가 한 번 도전할 때까지 기다림)
//   - 상대도 틀리면 기회가 다시 나에게 돌아와요.
//   - 선생님이 '기회 넘김 제한 시간'을 정해 두면, 그 시간이 지나면 다시 둘 다 도전할 수 있어요.
import { db } from './db.js';
import { checkBuild } from './puzzle.js';
import { eloDelta } from './tiers.js';
import { START_RATING } from './config.js';

export function opponentOf(g, me) {
  return Object.keys(g.players || {}).find((u) => u !== me) || null;
}

export function lockInfo(g, me, settings, now) {
  if (!g || g.status !== 'playing' || !g.lock) return { locked: false };
  const timeout = (settings?.passTimeoutSec || 0) * 1000;
  const expired = timeout > 0 && now - (g.lock.at || 0) >= timeout;
  if (expired) return { locked: false, expired: true };
  return {
    locked: g.lock.uid === me,          // 내가 틀려서 기다리는 중
    opponentLocked: g.lock.uid !== me,  // 상대가 틀려서 나에게 기회가 온 상태
    remainMs: timeout > 0 ? timeout - (now - g.lock.at) : null,
  };
}

// 정답 도전. 결과: { status: 'win' | 'wrong' | 'notYourTurn' | 'over', check }
export async function challenge(gid, me, heights, puzzle, settings) {
  const check = checkBuild(heights, puzzle);
  const key = db.newKey();
  let outcome = 'over';
  const res = await db.transaction(`games/${gid}`, (g) => {
    if (!g) return g; // 아직 데이터를 못 받은 경우 서버 값으로 다시 시도됨
    if (g.status !== 'playing') { outcome = 'over'; return undefined; }
    const now = db.now();
    if (lockInfo(g, me, settings, now).locked) { outcome = 'notYourTurn'; return undefined; }
    const opp = opponentOf(g, me);
    g.attempts = g.attempts || {};
    g.attempts[key] = { uid: me, ok: check.ok, at: now, n: check.ok ? null : (Object.keys(g.attempts).length + 1) };
    if (check.ok) {
      g.status = 'finished';
      g.winner = me;
      g.loser = opp;
      g.reason = 'solve';
      g.endedAt = now;
      g.lock = null;
      outcome = 'win';
    } else {
      g.lock = { uid: me, at: now };
      outcome = 'wrong';
    }
    return g;
  });
  if (!res.committed) return { status: outcome === 'win' || outcome === 'wrong' ? 'over' : outcome, check };
  if (outcome === 'win') await finalize(gid, res.value);
  return { status: outcome, check };
}

// 승패를 점수·전적에 반영 (게임을 끝낸 쪽이 한 번만 실행)
export async function finalize(gid, g) {
  if (!g || g.finalized) return;
  const { winner, loser } = g;
  const [uw, ul] = await Promise.all([db.get(`users/${winner}`), db.get(`users/${loser}`)]);
  const rw = uw?.rating ?? START_RATING;
  const rl = ul?.rating ?? START_RATING;
  const d = eloDelta(rw, rl);
  const secs = Math.round(((g.endedAt || 0) - (g.createdAt || 0)) / 1000);
  const attempts = Object.values(g.attempts || {});
  const common = { at: g.endedAt, level: g.puzzle?.level || 0, secs, reason: g.reason, gid };
  const up = {
    [`games/${gid}/finalized`]: true,
    [`games/${gid}/result`]: { delta: d, before: { [winner]: rw, [loser]: rl } },
    [`live/${gid}`]: null,
  };
  if (uw) {
    up[`users/${winner}/rating`] = rw + d;
    up[`users/${winner}/wins`] = (uw.wins || 0) + 1;
    up[`history/${winner}/${gid}`] = {
      ...common, opp: loser, oppName: g.players?.[loser] || '', win: true, delta: d, ratingAfter: rw + d,
      tries: attempts.filter((a) => a.uid === winner).length,
    };
  }
  if (ul) {
    up[`users/${loser}/rating`] = rl - d;
    up[`users/${loser}/losses`] = (ul.losses || 0) + 1;
    up[`history/${loser}/${gid}`] = {
      ...common, opp: winner, oppName: g.players?.[winner] || '', win: false, delta: -d, ratingAfter: rl - d,
      tries: attempts.filter((a) => a.uid === loser).length,
    };
  }
  await db.update('', up);
}

// 무효 처리 (선생님 또는 상대가 나가 버린 경우). 점수·전적에 반영하지 않습니다.
export async function cancelGame(gid, by) {
  const res = await db.transaction(`games/${gid}`, (g) => {
    if (!g) return g;
    if (g.status !== 'playing') return undefined;
    g.status = 'canceled';
    g.canceledBy = by || 'teacher';
    g.endedAt = db.now();
    g.lock = null;
    return g;
  });
  const g = res.value;
  const up = { [`live/${gid}`]: null };
  if (by === 'teacher' && g?.players) {
    // 선생님이 끝내면 두 학생 모두 로비로
    for (const uid of Object.keys(g.players)) up[`active/${uid}`] = null;
  }
  await db.update('', up);
  return res.committed;
}
