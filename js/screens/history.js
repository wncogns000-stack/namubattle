// 전적 보기 (#/history = 내 전적, #/history/:uid = 친구 전적, #/history/:uid/s1 = 마친 시즌의 전적)
import { h, tierEmblem, fmtDate, fmtDuration, promptBox, toast, avatar, modal, josa } from '../ui.js';
import { db } from '../db.js';
import { store, subscribe, standingOf } from '../store.js';
import { LEVELS, TIERS } from '../config.js';
import { formatWinRate, byOpponent, streakOf } from '../tiers.js';
import { session, setPresenceState } from '../session.js';
import { changeStudentPassword, isMainTeacher } from '../auth.js';
import { voidFinishedGames, restoreVoidedGames } from '../match.js';
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
  // 기본 학교 선생님: 끝난 대결 무효 처리 (지금 시즌 대결만)
  const admin = isMainTeacher();
  const sel = new Set(); // 고른 대결
  let voided = {};       // 무효 처리한 대결 (되돌리기용)
  let busy = false;
  const seasonStart = () => store.season?.startedAt || 0;

  // 다시 그려도 보던 자리(스크롤)는 그대로
  function render() {
    const y = window.scrollY;
    draw();
    if (window.scrollY !== y) window.scrollTo(0, y);
  }

  function draw() {
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
    const canVoid = admin && !past;
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
          h('thead', null, h('tr', null, h('th', null, '상대'), h('th', null, '승'), h('th', null, '패'), h('th', null, '승률'), canVoid ? h('th', null, '') : null)),
          h('tbody', null, opps.map((o) => h('tr', null,
            h('td', null, h('a', { href: past ? `#/history/${o.opp}/${seasonKey(past)}` : `#/history/${o.opp}`, class: 'opp-link' }, avatar(store.users[o.opp]?.name || o.oppName, o.opp), store.users[o.opp]?.name || o.oppName)),
            h('td', null, h('span', { class: 'res-win' }, `${o.wins}승`)), h('td', null, h('span', { class: 'res-lose' }, `${o.losses}패`)), h('td', null, formatWinRate(o.wins, o.losses)),
            canVoid ? h('td', { class: 'actions' }, (() => {
              const left = seasonHist.filter((r) => r.opp === o.opp && !voided[r.gid]);
              return left.length ? h('button', { class: 'btn btn-small', onclick: () => { for (const r of left) sel.add(r.gid); render(); } }, `이 친구와 ${left.length}판 모두 고르기`) : h('span', { class: 'muted small' }, '모두 무효 처리함');
            })()) : null,
          ))),
        )) : h('p', { class: 'empty' }, histLoaded ? '아직 대결 기록이 없어요.' : '불러오는 중…'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '📜'), past ? `시즌 ${past} 대결` : (canVoid ? `이번 시즌 대결 (${recent.length})` : '최근 대결')),
        canVoid && recent.length ? voidBar() : null,
        recent.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, canVoid ? h('th', null, '') : null, h('th', null, '날짜'), h('th', null, '상대'), h('th', null, '결과'), h('th', null, '점수'), h('th', null, '난이도'), h('th', null, '시간'))),
          h('tbody', null, (canVoid ? recent : recent.slice(0, 50)).map((r) => h('tr', { class: sel.has(r.gid) ? 'row-picked' : '' },
            canVoid ? h('td', null, voided[r.gid] ? h('span', { class: 'tag tag-muted', title: '이긴 쪽 점수를 뺐어요' }, '무효') : h('input', { type: 'checkbox', class: 'void-pick', 'aria-label': '이 대결 고르기', checked: sel.has(r.gid), onchange: (e) => {
              if (e.target.checked) sel.add(r.gid); else sel.delete(r.gid);
              e.target.closest('tr').classList.toggle('row-picked', e.target.checked);
              updateBar();
            } })) : null,
            h('td', null, fmtDate(r.at)),
            h('td', null, h('span', { class: 'opp-link' }, avatar(store.users[r.opp]?.name || r.oppName, r.opp), store.users[r.opp]?.name || r.oppName)),
            h('td', null, h('span', { class: r.win ? 'res-win' : 'res-lose' }, r.win ? '승' : '패'), r.reason === 'surrender' ? h('span', { class: 'muted small' }, ' (기권)') : null),
            h('td', { class: r.delta >= 0 ? 'plus' : 'minus' }, `${r.delta >= 0 ? '+' : ''}${r.delta}`),
            h('td', null, LEVELS[r.level]?.name || '-'),
            h('td', null, r.secs ? fmtDuration(r.secs * 1000) : '-'),
          ))),
        )) : h('p', { class: 'empty' }, histLoaded ? '아직 대결 기록이 없어요.' : '불러오는 중…'),
      ),
      canVoid ? voidedSection(name) : '',
    );
  }

  // ───────── 끝난 대결 무효 처리 (기본 학교 선생님) ─────────
  let bar = null;
  function voidBar() {
    bar = {
      count: h('b', null, ''),
      go: h('button', { class: 'btn btn-small btn-danger', onclick: () => voidPicked() }, '선택한 대결 무효 처리'),
      clear: h('button', { class: 'btn btn-small', onclick: () => { sel.clear(); render(); } }, '고른 것 지우기'),
    };
    updateBar();
    return h('div', { class: 'void-bar' },
      h('span', { class: 'void-bar-text' }, '👩‍🏫 선생님: 무효로 할 대결을 고르세요 ', bar.count),
      bar.go, bar.clear,
    );
  }

  function updateBar() {
    if (!bar) return;
    bar.count.textContent = sel.size ? `(${sel.size}판 고름)` : '';
    bar.go.disabled = !sel.size || busy;
    bar.clear.disabled = !sel.size || busy;
  }

  async function voidPicked() {
    const picked = hist.filter((r) => sel.has(r.gid) && !voided[r.gid]);
    if (!picked.length) return;
    // 이긴 학생별로 빠지는 점수·승 미리 보기 (진 학생은 그대로)
    const eff = {};
    for (const r of picked) {
      const w = r.win ? uid : r.opp;
      const x = (eff[w] ||= { nm: store.users[w]?.name || (r.win ? '' : r.oppName), rating: 0, wins: 0 });
      x.rating -= Math.abs(r.delta || 0); x.wins += 1;
    }
    const losers = [...new Set(picked.map((r) => (r.win ? store.users[r.opp]?.name || r.oppName : store.users[uid]?.name)))];
    const line = (x) => h('li', null, h('b', null, x.nm), ` 점수 ${x.rating}`, ` · ${x.wins}승 빠짐`);
    const ok = await modal({
      title: `대결 ${picked.length}판 무효 처리`,
      body: h('div', null,
        h('p', null, '제재로 이긴 학생에게서만 이 대결들로 얻은 점수와 승을 빼요.'),
        h('ul', { class: 'void-effects' }, Object.values(eff).map(line)),
        h('p', { class: 'muted small' }, `진 학생(${losers.join(', ')})의 점수·패와 전적은 그대로예요. 다른 학생 점수도 바뀌지 않아요. 아래 "무효 처리한 대결"에서 언제든 되돌릴 수 있어요.`),
      ),
      buttons: [{ label: '취소', value: false }, { label: `${picked.length}판 무효 처리`, value: true, kind: 'danger' }],
    });
    if (ok !== true) return;
    busy = true; updateBar();
    try {
      const n = await voidFinishedGames(picked.map((r) => r.gid), seasonStart());
      sel.clear();
      toast(n ? `${n}판을 무효 처리했어요.` : '무효로 할 수 있는 대결이 없었어요.', n ? 'ok' : 'warn');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
      render();
    }
  }

  function voidedSection(name) {
    const list = Object.entries(voided)
      .map(([gid, v]) => ({ gid, ...v }))
      .filter((v) => (v.winner === uid || v.loser === uid) && (v.endedAt || 0) >= seasonStart() && !v.restoring)
      .sort((a, b) => b.endedAt - a.endedAt);
    if (!list.length) return '';
    const restore = async (gids) => {
      if (busy) return;
      busy = true;
      try {
        const n = await restoreVoidedGames(gids, seasonStart());
        toast(`${n}판을 되돌렸어요.`, 'ok');
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        busy = false;
        render();
      }
    };
    return h('section', { class: 'card voided-card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🚫'), `무효 처리한 대결 (${list.length})`),
        h('button', { class: 'btn btn-small', onclick: () => restore(list.map((v) => v.gid)) }, '모두 되돌리기'),
      ),
      h('p', { class: 'muted small' }, `${josa(name, '이/가')} 들어 있는 무효 처리한 대결이에요. 이긴 학생에게서 점수와 승을 뺐어요. 되돌리면 다시 더해져요.`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['날짜', '상대', '결과', '점수', '뺀 것', '무효 처리한 때', ''].map((t) => h('th', null, t)))),
        h('tbody', null, list.map((v) => {
          const opp = v.winner === uid ? v.loser : v.winner;
          const win = v.winner === uid;
          return h('tr', null,
            h('td', null, fmtDate(v.endedAt)),
            h('td', null, h('span', { class: 'opp-link' }, avatar(store.users[opp]?.name || v.players?.[opp], opp), store.users[opp]?.name || v.players?.[opp] || '')),
            h('td', null, h('span', { class: win ? 'res-win' : 'res-lose' }, win ? '승' : '패')),
            h('td', null, `${win ? '+' : '-'}${v.delta}`),
            h('td', null, v.mode === 'winner' ? `${store.users[v.winner]?.name || v.players?.[v.winner] || ''} −${v.delta}점·1승` : '두 학생 모두'),
            h('td', null, fmtDate(v.at)),
            h('td', { class: 'actions' }, h('button', { class: 'btn btn-small', onclick: () => restore([v.gid]) }, '되돌리기')),
          );
        })),
      )),
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

  const offHist = db.on(`history/${uid}`, (v) => {
    hist = Object.entries(v || {}).map(([gid, r]) => ({ ...r, gid: r.gid || gid }));
    // 없어진 대결은 고른 것에서도 빼기
    for (const gid of [...sel]) if (!v?.[gid]) sel.delete(gid);
    histLoaded = true;
    render();
  });
  const offVoided = admin ? db.on('voided', (v) => { voided = v || {}; render(); }) : () => {};
  const off = subscribe((_, what) => { if (what === 'users' || what === 'season' || what === 'seasons' || what === 'schools') render(); });
  render();
  return () => { off(); offHist(); offVoided(); };
}
