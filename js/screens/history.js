// 전적 보기 (#/history = 내 전적, #/history/:uid = 친구 전적)
import { h, tierEmblem, fmtDate, fmtDuration, promptBox, toast, avatar } from '../ui.js';
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
      h('section', { class: `card player-card tier-bg-${s.tier.id}` },
        h('div', { class: 'pc-emblem' }, tierEmblem(s.tier, 104)),
        h('div', { class: 'pc-main' },
          h('div', { class: 'row-gap' },
            h('span', { class: 'pc-tier' }, s.ranked ? s.tier.name : `배치고사 ${s.games}/${s.games + s.placementLeft}`),
            st.n >= 2 ? h('span', { class: `streak ${st.win ? '' : 'lose'}` }, st.win ? `🔥 ${st.n}연승` : `${st.n}연패`) : null,
          ),
          h('div', { class: 'pc-name' }, mine ? `${s.name} (나)` : s.name),
          h('div', { class: 'stat-tiles' },
            stat('점수', s.rating),
            s.ranked ? stat('순위', `${s.rank + 1}등`) : null,
            stat('전적', `${s.wins}승 ${s.losses}패`),
            stat('승률', formatWinRate(s.wins, s.losses)),
          ),
          mine ? h('button', { class: 'btn btn-small', onclick: changePw }, '🔑 비밀번호 바꾸기') : null,
        ),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '👥'), '상대별 전적'),
        opps.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, '상대'), h('th', null, '승'), h('th', null, '패'), h('th', null, '승률'))),
          h('tbody', null, opps.map((o) => h('tr', null,
            h('td', null, h('a', { href: `#/history/${o.opp}`, class: 'opp-link' }, avatar(store.users[o.opp]?.name || o.oppName, o.opp), store.users[o.opp]?.name || o.oppName)),
            h('td', null, h('span', { class: 'res-win' }, `${o.wins}승`)), h('td', null, h('span', { class: 'res-lose' }, `${o.losses}패`)), h('td', null, formatWinRate(o.wins, o.losses)),
          ))),
        )) : h('p', { class: 'empty' }, '아직 대결 기록이 없어요.'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '📜'), '최근 대결'),
        recent.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, '날짜'), h('th', null, '상대'), h('th', null, '결과'), h('th', null, '점수'), h('th', null, '난이도'), h('th', null, '시간'))),
          h('tbody', null, recent.slice(0, 50).map((r) => h('tr', null,
            h('td', null, fmtDate(r.at)),
            h('td', null, h('span', { class: 'opp-link' }, avatar(store.users[r.opp]?.name || r.oppName, r.opp), store.users[r.opp]?.name || r.oppName)),
            h('td', null, h('span', { class: r.win ? 'res-win' : 'res-lose' }, r.win ? '승' : '패'), r.reason === 'surrender' ? h('span', { class: 'muted small' }, ' (기권)') : null),
            h('td', { class: r.delta >= 0 ? 'plus' : 'minus' }, `${r.delta >= 0 ? '+' : ''}${r.delta}`),
            h('td', null, LEVELS[r.level]?.name || '-'),
            h('td', null, r.secs ? fmtDuration(r.secs * 1000) : '-'),
          ))),
        )) : h('p', { class: 'empty' }, '아직 대결 기록이 없어요.'),
      ),
    );
  }

  function stat(label, value) {
    return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value));
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
