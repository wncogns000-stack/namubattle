// 전적 보기 (#/history = 내 전적, #/history/:uid = 친구 전적)
import { h, tierBadge, fmtDate, fmtDuration, promptBox, toast } from '../ui.js';
import { db } from '../db.js';
import { store, subscribe, standingOf } from '../store.js';
import { LEVELS } from '../config.js';
import { formatWinRate, byOpponent, streakOf } from '../tiers.js';
import { session, setPresenceState } from '../session.js';
import { changeStudentPassword } from '../auth.js';

export function mount(root, [uidParam]) {
  const uid = uidParam || session.uid;
  const mine = uid === session.uid;
  if (session.uid) setPresenceState('other');
  const box = h('div', { class: 'page history-page' });
  root.appendChild(box);
  let hist = [];

  function render() {
    box.innerHTML = '';
    const s = standingOf(uid);
    if (!s) {
      box.append(h('section', { class: 'card' }, h('p', null, '학생을 찾을 수 없어요.')));
      return;
    }
    const st = streakOf(hist);
    const opps = byOpponent(hist);
    const recent = [...hist].sort((a, b) => b.at - a.at);
    box.append(
      h('section', { class: `card profile tier-bg-${s.tier.id}` },
        tierBadge(s, { size: 72 }),
        h('div', { class: 'profile-main' },
          h('div', { class: 'profile-name' }, mine ? `${s.name} (나)` : s.name),
          h('div', { class: 'profile-stats' },
            h('span', null, '점수 ', h('b', null, s.rating)),
            s.ranked ? h('span', null, '순위 ', h('b', null, `${s.rank + 1}등`)) : null,
            h('span', null, h('b', null, `${s.wins}승 ${s.losses}패`)),
            h('span', null, '승률 ', h('b', null, formatWinRate(s.wins, s.losses))),
            st.n >= 2 ? h('span', { class: st.win ? 'streak-win' : 'streak-lose' }, st.win ? `🔥 ${st.n}연승` : `${st.n}연패`) : null,
          ),
          mine ? h('button', { class: 'btn btn-small', onclick: changePw }, '🔑 비밀번호 바꾸기') : null,
        ),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, '👥 상대별 전적'),
        opps.length ? h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, '상대'), h('th', null, '승'), h('th', null, '패'), h('th', null, '승률'))),
          h('tbody', null, opps.map((o) => h('tr', null,
            h('td', null, h('a', { href: `#/history/${o.opp}` }, store.users[o.opp]?.name || o.oppName)),
            h('td', null, o.wins), h('td', null, o.losses), h('td', null, formatWinRate(o.wins, o.losses)),
          ))),
        ) : h('p', { class: 'empty' }, '아직 대결 기록이 없어요.'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, '📜 최근 대결'),
        recent.length ? h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, '날짜'), h('th', null, '상대'), h('th', null, '결과'), h('th', null, '점수'), h('th', null, '난이도'), h('th', null, '시간'))),
          h('tbody', null, recent.slice(0, 50).map((r) => h('tr', null,
            h('td', null, fmtDate(r.at)),
            h('td', null, store.users[r.opp]?.name || r.oppName),
            h('td', null, h('span', { class: r.win ? 'res-win' : 'res-lose' }, r.win ? '승' : '패'), r.reason === 'surrender' ? h('span', { class: 'muted small' }, ' (기권)') : null),
            h('td', { class: r.delta >= 0 ? 'plus' : 'minus' }, `${r.delta >= 0 ? '+' : ''}${r.delta}`),
            h('td', null, LEVELS[r.level]?.name || '-'),
            h('td', null, r.secs ? fmtDuration(r.secs * 1000) : '-'),
          ))),
        ) : h('p', { class: 'empty' }, '아직 대결 기록이 없어요.'),
      ),
    );
  }

  async function changePw() {
    const v = await promptBox('비밀번호 바꾸기', [
      { name: 'old', label: '지금 비밀번호', type: 'password' },
      { name: 'pw1', label: '새 비밀번호', type: 'password' },
      { name: 'pw2', label: '새 비밀번호 한 번 더', type: 'password' },
    ], '바꾸기');
    if (!v) return;
    if (!v.pw1 || v.pw1.length < 4) return toast('새 비밀번호는 4글자 이상으로 해 주세요.', 'warn');
    if (v.pw1 !== v.pw2) return toast('새 비밀번호가 서로 달라요.', 'warn');
    try {
      await changeStudentPassword(session.uid, v.old, v.pw1);
      toast('비밀번호를 바꿨어요.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const offHist = db.on(`history/${uid}`, (v) => { hist = Object.values(v || {}); render(); });
  const off = subscribe((_, what) => { if (what === 'users') render(); });
  render();
  return () => { off(); offHist(); };
}
