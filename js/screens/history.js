// 전적 보기 (#/history = 내 전적, #/history/:uid = 친구 전적, #/history/:uid/s1 = 마친 시즌의 전적)
import { h, tierEmblem, fmtDate, fmtDuration, promptBox, toast, avatar } from '../ui.js';
import { db } from '../db.js';
import { store, subscribe, standingOf } from '../store.js';
import { LEVELS, TIERS } from '../config.js';
import { formatWinRate, byOpponent, streakOf } from '../tiers.js';
import { session, setPresenceState } from '../session.js';
import { changeStudentPassword } from '../auth.js';
import { schoolChip } from '../schools.js';
import { currentSeason, pastSeasons, parseSeasonParam, seasonData, seasonStandings, filterSeason, seasonPeriodText, seasonPicker, seasonBadge, seasonKey } from '../seasons.js';

export function mount(root, [uidParam, seasonParam]) {
  const uid = uidParam || session.uid;
  const mine = uid === session.uid;
  if (session.uid) setPresenceState('other');
  const box = h('div', { class: 'page history-page' });
  root.appendChild(box);
  let hist = [];
  let histLoaded = false; // 기록이 오기 전에는 '기록 없음' 대신 '불러오는 중'

  function render() {
    box.innerHTML = '';
    const past = parseSeasonParam(seasonParam);
    const cur = currentSeason();
    const now = standingOf(uid);
    // 지난 시즌: 보관한 최종 기록 / 지금 시즌: 지금 기록
    const s = past ? seasonStandings(past)?.byUid[uid] : now;
    const name = now?.name || s?.name;
    if (!now && !s) {
      box.append(h('section', { class: 'card' }, h('p', null, '학생을 찾을 수 없어요.')));
      return;
    }
    const base = `#/history/${uid}`;
    const picker = seasonPicker(base, past || cur);
    if (picker) box.append(picker);
    if (past && !s) {
      box.append(h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🏁'), `${name} · 시즌 ${past}`),
        h('p', { class: 'empty' }, `시즌 ${past}에는 대결 기록이 없어요.`),
      ));
      return;
    }
    const seasonHist = filterSeason(hist, past || cur);
    const st = streakOf(seasonHist);
    const opps = byOpponent(seasonHist);
    const recent = [...seasonHist].sort((a, b) => b.at - a.at);
    const winRank = past ? seasonData(past)?.players?.[uid]?.winRank : null;
    // 지난 시즌들 한 줄 요약 (지금 시즌 화면에서)
    const pastRows = past ? [] : pastSeasons().map((n) => {
      const p = seasonData(n)?.players?.[uid];
      if (!p) return null;
      const t = p.ranked ? TIERS.find((x) => x.id === p.tier) : null;
      return h('a', { class: `past-season-row ${t ? `tier-${t.id}` : ''}`, href: `${base}/${seasonKey(n)}` },
        h('b', null, `시즌 ${n}`),
        t ? h('span', { class: 'past-tier' }, tierEmblem(t, 20), t.name, ` ${p.rank + 1}등`) : h('span', { class: 'muted' }, '배치고사 미완료'),
        h('span', null, `${p.wins || 0}승 ${p.losses || 0}패`),
        p.winRank != null ? h('span', { class: 'muted' }, `승수 ${p.winRank + 1}등`) : null,
      );
    }).filter(Boolean);
    box.append(
      h('section', { class: `card player-card tier-bg-${s.tier.id}` },
        h('div', { class: 'pc-emblem' }, tierEmblem(s.tier, 104)),
        h('div', { class: 'pc-main' },
          h('div', { class: 'row-gap' },
            past ? h('span', { class: 'pc-tier' }, `시즌 ${past} 최종`) : null,
            h('span', { class: 'pc-tier' }, s.ranked ? s.tier.name : (past ? '배치고사 미완료' : `배치고사 ${s.games}/${s.games + s.placementLeft}`)),
            !past && st.n >= 2 ? h('span', { class: `streak ${st.win ? '' : 'lose'}` }, st.win ? `🔥 ${st.n}연승` : `${st.n}연패`) : null,
          ),
          h('div', { class: 'pc-name' }, mine ? `${name} (나)` : name, past ? schoolChip(null, { sid: s.school || 'main' }) : schoolChip(uid), past ? null : seasonBadge(uid, { size: 18 })),
          h('div', { class: 'stat-tiles' },
            stat('점수', s.rating),
            s.ranked ? stat('순위', `${s.rank + 1}등`) : null,
            stat('전적', `${s.wins}승 ${s.losses}패`),
            stat('승률', formatWinRate(s.wins, s.losses)),
            winRank != null ? stat('승수 순위', `${winRank + 1}등`) : null,
          ),
          past ? h('div', { class: 'pc-note' }, `${seasonPeriodText(past)} · 시즌을 마칠 때의 기록이에요.`) : null,
          mine && !past ? h('button', { class: 'btn btn-small', onclick: changePw }, '🔑 비밀번호 바꾸기') : null,
        ),
      ),
      pastRows.length ? h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '📚'), '지난 시즌 기록'),
        h('div', { class: 'past-season-list' }, pastRows),
      ) : '',
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '👥'), `상대별 전적${pastSeasons().length ? ` (시즌 ${past || cur})` : ''}`),
        opps.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, '상대'), h('th', null, '승'), h('th', null, '패'), h('th', null, '승률'))),
          h('tbody', null, opps.map((o) => h('tr', null,
            h('td', null, h('a', { href: past ? `#/history/${o.opp}/${seasonKey(past)}` : `#/history/${o.opp}`, class: 'opp-link' }, avatar(store.users[o.opp]?.name || o.oppName, o.opp), store.users[o.opp]?.name || o.oppName)),
            h('td', null, h('span', { class: 'res-win' }, `${o.wins}승`)), h('td', null, h('span', { class: 'res-lose' }, `${o.losses}패`)), h('td', null, formatWinRate(o.wins, o.losses)),
          ))),
        )) : h('p', { class: 'empty' }, histLoaded ? '아직 대결 기록이 없어요.' : '불러오는 중…'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '📜'), past ? `시즌 ${past} 대결` : '최근 대결'),
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
        )) : h('p', { class: 'empty' }, histLoaded ? '아직 대결 기록이 없어요.' : '불러오는 중…'),
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

  const offHist = db.on(`history/${uid}`, (v) => { hist = Object.values(v || {}); histLoaded = true; render(); });
  const off = subscribe((_, what) => { if (what === 'users' || what === 'season' || what === 'seasons' || what === 'schools') render(); });
  render();
  return () => { off(); offHist(); };
}
