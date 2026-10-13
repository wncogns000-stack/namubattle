// 선생님 페이지: 학생 등록, 비밀번호 초기화, 진행 중인 대결 관리, 설정, 초기화
import { h, toast, confirmBox, promptBox, tierBadge, fmtDuration, fmtTime } from '../ui.js';
import { db } from '../db.js';
import { store, subscribe, isOnline, battleOpen, battleOf, schoolOf } from '../store.js';
import { DEFAULT_SETTINGS, LEVELS, START_RATING, TIERS } from '../config.js';
import { formatWinRate, buildSeasonSnapshot } from '../tiers.js';
import { currentSeason, pastSeasons, seasonData, seasonKey, seasonPeriodText, seasonStandings } from '../seasons.js';
import { teacherExists, setupTeacher, loginTeacher, isTeacher, logoutTeacher, makeSecret, normalizeName, checkSecret, teacherSchool, isMainTeacher, teacherPath } from '../auth.js';
import { MAIN, schoolList, multiSchool, schoolName, schoolChip, battlePath } from '../schools.js';
import { cancelGame } from '../match.js';
import { APP_VERSION } from '../update.js';

const LAST_SCHOOL_KEY = 'namubattle-teacher-school';

const SAMPLE_NAMES = ['민준', '서연', '도윤', '하은', '시우', '지우', '주원', '서윤', '하준', '지민', '예준', '수아', '유준',
  '하린', '은우', '지아', '건우', '다은', '우진', '채원', '선우', '윤서', '현우', '소율', '지호'];

export function mount(root) {
  const box = h('div', { class: 'page teacher-page' });
  root.appendChild(box);
  let tab = 'students';
  let off = null;
  let tsid = MAIN;   // 로그인한 선생님의 학교
  let admin = false; // 기본 학교 선생님인지

  async function start() {
    box.innerHTML = '';
    if (isTeacher()) return renderMain();
    const exists = await teacherExists(MAIN);
    const pw = h('input', { type: 'password', autocomplete: 'off', placeholder: '선생님 비밀번호' });
    const pw2 = h('input', { type: 'password', autocomplete: 'off', placeholder: '한 번 더' });
    // 여러 학교면 어느 학교 선생님인지 고르기
    const schools = schoolList();
    let last = null;
    try { last = localStorage.getItem(LAST_SCHOOL_KEY); } catch { /* 무시 */ }
    const schoolSel = exists && schools.length > 1
      ? h('select', null, schools.map((sc) => h('option', { value: sc.id, selected: sc.id === last }, sc.name)))
      : null;
    const form = h('form', { class: 'card login-card', onsubmit: async (e) => {
      e.preventDefault();
      try {
        if (!exists) {
          if (pw.value.length < 4) throw new Error('비밀번호는 4글자 이상으로 해 주세요.');
          if (pw.value !== pw2.value) throw new Error('두 비밀번호가 달라요.');
          await setupTeacher(pw.value);
          toast('선생님 비밀번호를 만들었어요.', 'ok');
        } else {
          const sid = schoolSel ? schoolSel.value : MAIN;
          await loginTeacher(pw.value, sid);
          try { localStorage.setItem(LAST_SCHOOL_KEY, sid); } catch { /* 무시 */ }
        }
        renderMain();
      } catch (err) {
        toast(err.message, 'error');
      }
    } },
      h('h2', null, '👩‍🏫 선생님 페이지'),
      exists ? h('p', { class: 'muted' }, '선생님 비밀번호를 입력하세요.')
        : h('p', { class: 'muted' }, '처음 오셨네요! 선생님 비밀번호를 만들어 주세요. 학생 등록과 관리에 쓰여요.'),
      schoolSel ? h('label', { class: 'field' }, h('span', null, '학교'), schoolSel) : null,
      h('label', { class: 'field' }, h('span', null, '비밀번호'), pw),
      exists ? null : h('label', { class: 'field' }, h('span', null, '비밀번호 확인'), pw2),
      h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, exists ? '들어가기' : '비밀번호 만들기'),
      h('a', { href: '#/login', class: 'small' }, '← 학생 로그인 화면'),
    );
    box.append(h('div', { class: 'center-page' }, form));
    setTimeout(() => pw.focus(), 30);
  }

  function renderMain() {
    off && off();
    tsid = teacherSchool() || MAIN;
    admin = isMainTeacher();
    const content = h('div');
    const battleBox = h('div');
    // 기본 학교 선생님: 모든 탭 / 다른 학교 선생님: 자기 학교 학생·대결만
    const tabs = admin ? [
      ['students', '학생 관리'],
      ['live', '진행 중인 대결'],
      ['settings', '게임 설정'],
      ['schools', '학교'],
      ['season', '시즌'],
      ['reset', '초기화·체험'],
    ] : [
      ['students', '학생 관리'],
      ['live', '진행 중인 대결'],
      ['season', '시즌'],
      ['account', '비밀번호'],
    ];
    if (!tabs.some(([k]) => k === tab)) tab = 'students';
    const tabBar = h('div', { class: 'tabs' }, tabs.map(([k, label]) => h('button', {
      class: `tab ${tab === k ? 'on' : ''}`,
      onclick: () => { tab = k; renderMain(); },
    }, label)));
    box.innerHTML = '';
    box.append(
      h('div', { class: 'card teacher-head' },
        h('h2', { class: 'card-title', style: { margin: '0' } }, h('span', { class: 'title-icon' }, '👩‍🏫'), multiSchool() ? `${schoolName(tsid)} 선생님` : '선생님 페이지'),
        h('span', { class: 'mode-chip' }, db.mode === 'local' ? '💡 체험 모드 (이 브라우저에만 저장)' : '🟢 Firebase 연결됨'),
        h('span', { class: 'mode-chip', title: '게임 버전' }, `버전 ${APP_VERSION}`),
        h('button', { class: 'btn btn-small', onclick: () => { logoutTeacher(); start(); } }, '나가기'),
      ),
      battleBox,
      tabBar,
      content,
    );
    const drawBattle = () => {
      // 내용이 그대로면 다시 그리지 않음 (누르려던 버튼이 바뀌지 않도록)
      const until = battleOf(tsid).until;
      const others = schoolList().filter((sc) => sc.id !== tsid).map((sc) => [sc.id, sc.name, battleOpen(sc.id), battleOf(sc.id).until]);
      const key = JSON.stringify([battleOpen(tsid), until, myLiveCount(), until ? Math.ceil((until - db.now()) / 60_000) : 0, others]);
      if (battleBox.dataset.key === key) return;
      battleBox.dataset.key = key;
      battleBox.innerHTML = '';
      battleBox.appendChild(battleControl());
    };
    drawBattle();
    const draw = () => {
      content.innerHTML = '';
      ({ students: drawStudents, live: drawLive, settings: drawSettings, schools: drawSchools, season: drawSeason, reset: drawReset, account: drawAccount })[tab](content);
    };
    draw();
    let lastOnline = '';
    const offBattle = subscribe((_, what) => {
      // 학교가 추가·이름 변경되면 제목·탭까지 새로 (게임 설정을 고치는 중이면 입력이 지워지지 않게 그대로)
      if (what === 'schools' && tab !== 'settings') return renderMain();
      if (what === 'battle' || what === 'live' || what === 'schools') drawBattle();
    });
    const battleTimer = setInterval(drawBattle, 15_000); // 남은 시간 표시
    const offMain = subscribe((_, what) => {
      if (tab === 'settings' || tab === 'schools' || tab === 'account') return; // 입력 중인 값이 지워지지 않도록
      if (tab === 'reset') return;
      if (what === 'queue' && tab !== 'live') return;
      if (what === 'presence') {
        if (tab !== 'live' && tab !== 'students') return;
        // 접속 신호는 1초에도 몇 번씩 오므로, 접속한 학생이 바뀌었을 때만(대결 탭은 지난 시간 표시 때문에 10초마다) 다시 그림
        const key = store.standings.list.filter((s) => isOnline(s.uid)).map((s) => s.uid).join() + (tab === 'live' ? `|${Math.floor(db.now() / 10000)}` : '');
        if (key === lastOnline) return;
        lastOnline = key;
      }
      if (document.activeElement && content.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
      draw();
    });
    off = () => { offMain(); offBattle(); clearInterval(battleTimer); };
  }

  // ───────── 대결 열기·닫기 ─────────
  // 선생님이 열어 둔 동안에만 학생끼리 대결할 수 있어요. (로그인·혼자 연습·랭킹은 언제나 가능)
  // 우리 학교 학생이 들어 있는 진행 중인 대결 수
  function myLiveCount() {
    return Object.values(store.live || {}).filter((g) => Object.keys(g.players || {}).some((u) => schoolOf(u) === tsid)).length;
  }

  function battleControl() {
    const open = battleOpen(tsid);
    const until = battleOf(tsid).until;
    const liveCount = myLiveCount();
    const setBattle = async (minutes) => {
      const now = db.now();
      try {
        if (minutes === null) {
          // 우리 학교 학생 중 대결 찾는 중이던 학생도 정리 (다른 학교 학생은 그대로)
          const up = { [battlePath(tsid)]: { open: false, at: now } };
          for (const uid of Object.keys(store.queue || {})) if (schoolOf(uid) === tsid) up[`queue/${uid}`] = null;
          await db.update('', up);
          toast('대결을 닫았어요.', 'ok');
        } else {
          await db.set(battlePath(tsid), { open: true, until: minutes ? now + minutes * 60_000 : null, at: now });
          toast(minutes ? `대결을 열었어요. ${fmtTime(now + minutes * 60_000)}에 저절로 닫혀요.` : '대결을 열었어요. 닫기 전까지 계속 열려 있어요.', 'ok');
        }
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    const choices = (labels) => [
      h('button', { class: `btn btn-small ${open ? '' : 'btn-primary'}`, onclick: () => setBattle(40) }, labels[0]),
      h('button', { class: 'btn btn-small', onclick: () => setBattle(80) }, labels[1]),
      h('button', { class: 'btn btn-small', onclick: () => setBattle(0) }, labels[2]),
    ];
    let desc;
    if (!open) desc = '학생들은 로그인, 혼자 연습, 랭킹·전적 보기만 할 수 있어요.';
    else if (until) desc = `${fmtTime(until)}에 저절로 닫혀요. (${Math.max(1, Math.ceil((until - db.now()) / 60_000))}분 남음)`;
    else desc = '선생님이 닫을 때까지 열려 있어요.';
    if (!open && liveCount) desc += ` 진행 중인 대결 ${liveCount}개는 끝까지 할 수 있어요.`;
    const others = multiSchool() ? schoolList().filter((sc) => sc.id !== tsid) : [];
    return h('section', { class: `card battle-control ${open ? 'is-open' : 'is-closed'}` },
      h('div', { class: 'bc-main' },
        h('span', { class: 'bc-state' }, `${multiSchool() ? schoolName(tsid) + ' ' : ''}${open ? '🔓 대결 열림' : '🔒 대결 닫힘'}`),
        h('span', { class: 'bc-desc' }, desc),
        others.length ? h('span', { class: 'bc-others' }, others.map((sc) => {
          const o = battleOpen(sc.id);
          const u = battleOf(sc.id).until;
          return `${sc.name}: ${o ? `열림${u ? ` (${fmtTime(u)}까지)` : ''}` : '닫힘'}`;
        }).join(' · '), ' — 다른 학교 친구와는 두 학교가 모두 열려 있을 때 대결해요.') : null,
      ),
      h('div', { class: 'bc-buttons' },
        open
          ? [h('button', { class: 'btn btn-small btn-danger', onclick: () => setBattle(null) }, '🔒 지금 닫기'), ...choices(['지금부터 40분', '지금부터 80분', '닫을 때까지'])]
          : choices(['⚔️ 40분 동안 열기', '80분 동안 열기', '닫을 때까지 열기']),
      ),
    );
  }

  // ───────── 학생 관리 ─────────
  function drawStudents(el) {
    const list = store.standings.list.filter((s) => schoolOf(s.uid) === tsid).sort((a, b) => (a.no ?? 999) - (b.no ?? 999) || String(a.name).localeCompare(String(b.name), 'ko'));
    const ta = h('textarea', { rows: 6, placeholder: '한 줄에 한 명씩: 번호 이름 비밀번호\n예)\n1 주채훈 1234\n2 이서연 5678' });
    el.append(
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🧑‍🎓'), `${multiSchool() ? schoolName(tsid) + ' ' : ''}학생 목록 (${list.length}명)`),
        multiSchool() ? h('p', { class: 'muted small' }, '티어와 순위는 모든 학교 학생을 합쳐서 정해져요.') : null,
        list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['번호', '이름', '티어', '점수', '전적', '승률', '접속', ''].map((t) => h('th', null, t)))),
          h('tbody', null, list.map((s) => h('tr', null,
            h('td', null, s.no ?? '-'),
            h('td', null, h('a', { href: `#/history/${s.uid}` }, s.name)),
            h('td', null, tierBadge(s, { size: 22 })),
            h('td', null, s.rating),
            h('td', null, `${s.wins}승 ${s.losses}패`),
            h('td', null, formatWinRate(s.wins, s.losses)),
            h('td', null, isOnline(s.uid) ? '🟢' : ''),
            h('td', { class: 'actions' },
              h('button', { class: 'btn btn-small', onclick: () => resetPw(s) }, '비밀번호'),
              h('button', { class: 'btn btn-small', onclick: () => rename(s) }, '이름'),
              h('button', { class: 'btn btn-small btn-danger', onclick: () => removeStudent(s) }, '삭제'),
            ),
          ))),
        )) : h('p', { class: 'empty' }, '아직 등록된 학생이 없어요. 아래에서 등록해 주세요.'),
        list.length ? h('button', { class: 'btn btn-small', onclick: exportCsv }, '📥 전적 CSV 내려받기') : null,
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '➕'), '학생 등록'),
        h('p', { class: 'muted small' }, '번호·이름·비밀번호를 띄어쓰기, 쉼표 또는 탭으로 구분해 붙여 넣으세요. 엑셀에서 세 칸을 복사해 붙여 넣어도 돼요. 이름이 같은 학생이 있으면 "주채훈A"처럼 구분해 주세요. 비밀번호는 4글자 이상.'),
        ta,
        h('button', { class: 'btn btn-primary', onclick: () => addStudents(ta.value).then((ok) => { if (ok) ta.value = ''; }) }, '등록하기'),
      ),
    );
  }

  // sid: 등록할 학교 (기본: 로그인한 선생님의 학교). 기본 학교 학생은 예전처럼 학교 정보 없이 저장
  async function addStudents(text, sid = tsid) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return toast('등록할 학생을 입력해 주세요.', 'warn');
    const existing = new Set(Object.entries(store.users).filter(([uid]) => schoolOf(uid) === sid).map(([, u]) => normalizeName(u.name)));
    const rows = [];
    const errors = [];
    for (const line of lines) {
      const parts = line.split(/[\t,]+|\s+/).map((p) => p.trim()).filter(Boolean);
      let no = null, name, pw;
      if (parts.length >= 3 && /^\d+$/.test(parts[0])) [no, name, pw] = [Number(parts[0]), parts[1], parts.slice(2).join('')];
      else if (parts.length === 2) [name, pw] = parts;
      else { errors.push(`형식 오류: ${line}`); continue; }
      const key = normalizeName(name);
      if (!key) { errors.push(`이름 없음: ${line}`); continue; }
      if (!pw || pw.length < 4) { errors.push(`${name}: 비밀번호는 4글자 이상`); continue; }
      if (existing.has(key)) { errors.push(`${name}: 이미 있는 이름`); continue; }
      existing.add(key);
      rows.push({ no, name: key, pw });
    }
    if (rows.length) {
      const up = {};
      for (const r of rows) {
        const uid = 'u' + db.newKey();
        up[`users/${uid}`] = { name: r.name, no: r.no, rating: START_RATING, wins: 0, losses: 0, createdAt: db.now(), ...(sid !== MAIN ? { school: sid } : {}) };
        up[`secrets/${uid}`] = await makeSecret(r.pw);
      }
      await db.update('', up);
      toast(`${rows.length}명을 등록했어요.`, 'ok');
    }
    if (errors.length) toast(errors.join(' / '), 'warn', 6000);
    return errors.length === 0;
  }

  async function resetPw(s) {
    const v = await promptBox(`${s.name} 비밀번호 바꾸기`, [{ name: 'pw', label: '새 비밀번호', type: 'text' }], '바꾸기');
    if (!v) return;
    if (v.pw.length < 4) return toast('비밀번호는 4글자 이상으로 해 주세요.', 'warn');
    await db.set(`secrets/${s.uid}`, await makeSecret(v.pw));
    toast(`${s.name} 비밀번호를 바꿨어요.`, 'ok');
  }

  async function rename(s) {
    const v = await promptBox('이름·번호 바꾸기', [
      { name: 'name', label: '이름', value: s.name },
      { name: 'no', label: '번호', value: s.no ?? '' },
    ], '저장');
    if (!v) return;
    const name = normalizeName(v.name);
    if (!name) return toast('이름을 입력해 주세요.', 'warn');
    const dup = Object.entries(store.users).some(([uid, u]) => uid !== s.uid && schoolOf(uid) === schoolOf(s.uid) && normalizeName(u.name) === name);
    if (dup) return toast('이미 있는 이름이에요.', 'warn');
    await db.update(`users/${s.uid}`, { name, no: v.no === '' ? null : Number(v.no) });
    toast('저장했어요.', 'ok');
  }

  async function removeStudent(s) {
    if (!(await confirmBox('학생 삭제', `${s.name} 학생과 전적을 모두 지울까요? 되돌릴 수 없어요.`, '삭제', 'danger'))) return;
    await db.update('', {
      [`users/${s.uid}`]: null, [`secrets/${s.uid}`]: null, [`history/${s.uid}`]: null,
      [`active/${s.uid}`]: null, [`presence/${s.uid}`]: null, [`invites/${s.uid}`]: null,
    });
    toast('삭제했어요.');
  }

  function exportCsv() {
    const rows = [['번호', '이름', '티어', '순위', '점수', '승', '패', '승률']];
    for (const s of store.standings.list.filter((x) => schoolOf(x.uid) === tsid)) {
      rows.push([s.no ?? '', s.name, s.ranked ? s.tier.name : '배치고사', s.ranked ? s.rank + 1 : '', s.rating, s.wins, s.losses, formatWinRate(s.wins, s.losses)]);
    }
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `쌓기나무배틀_전적_${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ───────── 진행 중인 대결 ─────────
  function drawLive(el) {
    const games = Object.entries(store.live || {}).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    const online = store.standings.list.filter((s) => isOnline(s.uid) && schoolOf(s.uid) === tsid);
    const searching = online.filter((s) => store.queue?.[s.uid]);
    const nameWithSchool = (uid, name) => h('span', { class: 'name-with-school' }, name, schoolChip(uid));
    el.append(
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '⚔️'), `진행 중인 대결 (${games.length})`),
        games.length ? h('ul', { class: 'player-list' }, games.map(([gid, g]) => {
          const names = Object.values(g.players || {});
          const uids = Object.keys(g.players || {});
          // 다른 학교 선생님은 자기 학교 학생이 들어 있는 대결만 무효 처리할 수 있음
          const mine = admin || uids.some((u) => schoolOf(u) === tsid);
          return h('li', { class: 'player-row' },
            h('b', { class: 'live-names' }, nameWithSchool(uids[0], names[0]), ' vs ', nameWithSchool(uids[1], names[1])),
            h('span', { class: 'player-meta' }, `${LEVELS[g.level]?.name || ''} · ${fmtDuration(db.now() - (g.createdAt || db.now()))} 지남`),
            mine ? h('button', { class: 'btn btn-small btn-danger', onclick: async () => {
              if (await confirmBox('대결 무효', `${names[0]} vs ${names[1]} 대결을 무효로 끝낼까요? 점수에 반영되지 않아요.`, '무효 처리', 'danger')) {
                await cancelGame(gid, 'teacher');
                await db.remove(`live/${gid}`);
                toast('무효 처리했어요.');
              }
            } }, '무효 처리') : null,
          );
        })) : h('p', { class: 'empty' }, '진행 중인 대결이 없어요.'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🔎'), `대결 찾는 중 (${searching.length})`),
        h('p', null, searching.map((s) => s.name).join(', ') || '없음'),
        h('p', { class: 'muted small' }, '티어 조건에 맞는 친구끼리 자동으로 짝지어져요. 맞는 친구가 없으면 나타날 때까지 기다려요.'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🟢'), `접속 중인 학생 (${online.length})`),
        h('p', null, online.map((s) => s.name).join(', ') || '없음'),
      ),
    );
  }

  // ───────── 설정 ─────────
  function drawSettings(el) {
    const s = store.settings;
    const sel = (opts, value) => h('select', null, opts.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
    const gap = sel([1, 2, 3, 4, 9].map((v) => [v, v === 9 ? '제한 없음' : `${v}단계 차이까지`]), s.tierGap);
    const placement = sel([0, 1, 2, 3, 5].map((v) => [v, v === 0 ? '없음' : `${v}판`]), s.placementGames);
    const timeout = sel([[0, '상대가 도전할 때까지 기다림'], [30, '30초'], [60, '1분'], [120, '2분']], s.passTimeoutSec);
    const direct = sel([[0, '끔 — 대결 찾기(자동 매칭)만'], [1, '켬 — 자동 매칭 + 친구에게 직접 신청']], s.directInvite ? 1 : 0);
    const sound = sel([[1, '켬'], [0, '끔 — 모든 학생 기기에서 소리 없음']], s.sound === false ? 0 : 1);
    const level = sel([[0, '자동 (티어에 따라)'], ...Object.entries(LEVELS).map(([k, L]) => [k, `${L.name} 고정 (${L.n}×${L.n}, ${L.maxH}층, ${L.count[0]}~${L.count[1]}개)`])], s.level);
    el.append(h('section', { class: 'card form' },
      h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '⚙️'), '게임 설정'),
      h('label', { class: 'field' }, h('span', null, '친구에게 직접 대결 신청'), direct,
        h('small', { class: 'muted' }, '기본은 꺼짐: 학생들이 "대결 찾기"를 누르면 비슷한 티어 친구와 무작위로 짝지어져요. 켜면 로비에서 원하는 친구에게 직접 신청도 할 수 있어요(친한 친구끼리 번갈아 져 주며 승수를 쌓을 수 있으니 보상을 걸 때는 꺼 두기를 권해요).')),
      h('label', { class: 'field' }, h('span', null, '대결할 수 있는 티어 차이'), gap,
        h('small', { class: 'muted' }, `예: 2단계 → 골드는 에메랄드·플래티넘·골드·실버·브론즈와 대결 가능. 티어 순서: ${TIERS.map((t) => t.name).join(' > ')}`)),
      h('label', { class: 'field' }, h('span', null, '배치고사 판수'), placement,
        h('small', { class: 'muted' }, '배치고사 중에는 누구와도 대결할 수 있고, 다 마치면 점수 순위로 티어가 정해져요.')),
      h('label', { class: 'field' }, h('span', null, '틀렸을 때 넘어간 기회가 다시 열리는 시간'), timeout,
        h('small', { class: 'muted' }, '상대가 일부러 도전하지 않고 시간을 끄는 것을 막고 싶을 때 정하세요.')),
      h('label', { class: 'field' }, h('span', null, '문제 난이도'), level),
      h('label', { class: 'field' }, h('span', null, '효과음'), sound,
        h('small', { class: 'muted' }, '쌓기, 상대 찾음, 대결 시작, 승리·패배 등에 짧은 소리가 나요(배경 음악은 없어요). 학생마다 위쪽 🔊 버튼으로 자기 기기만 끌 수도 있어요.')),
      h('div', { class: 'row-gap' },
        h('button', { class: 'btn btn-primary', onclick: async () => {
          await db.set('config/settings', {
            tierGap: Number(gap.value), placementGames: Number(placement.value),
            passTimeoutSec: Number(timeout.value), level: Number(level.value),
            directInvite: direct.value === '1',
            sound: sound.value === '1',
          });
          toast('설정을 저장했어요.', 'ok');
        } }, '저장'),
        h('button', { class: 'btn', onclick: async () => {
          await db.set('config/settings', DEFAULT_SETTINGS);
          toast('기본값으로 되돌렸어요.');
          renderMain();
        } }, '기본값으로'),
      ),
    ));
  }

  // ───────── 학교 (기본 학교 선생님만) ─────────
  function drawSchools(el) {
    const list = schoolList();
    const count = (sid) => Object.keys(store.users).filter((uid) => schoolOf(uid) === sid).length;
    const nameIn = h('input', { type: 'text', autocomplete: 'off', placeholder: '예: 대서초' });
    const pwIn = h('input', { type: 'text', autocomplete: 'off', placeholder: '4글자 이상' });
    el.append(
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🏫'), `함께 하는 학교 (${list.length})`),
        h('p', { class: 'muted small' }, '학교마다 선생님 비밀번호, 학생 명단, 대결 시간이 따로예요. 랭킹·티어는 모든 학교 학생을 합쳐서 정하고, 학교별 승패 합계는 보여 주지 않아요. 대결 찾기는 조건이 맞는 친구 중 되도록 다른 학교 친구와 짝지어요.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['학교', '학생 수', ''].map((t) => h('th', null, t)))),
          h('tbody', null, list.map((sc) => h('tr', null,
            h('td', null, h('b', null, sc.name), sc.id === MAIN ? h('small', { class: 'muted' }, ' (기본 학교 · 게임 설정 관리)') : null),
            h('td', null, `${count(sc.id)}명`),
            h('td', { class: 'actions' },
              h('button', { class: 'btn btn-small', onclick: () => renameSchool(sc) }, '이름'),
              sc.id !== MAIN ? h('button', { class: 'btn btn-small', onclick: () => resetSchoolPw(sc) }, '선생님 비밀번호') : null,
              sc.id !== MAIN ? h('button', { class: 'btn btn-small btn-danger', onclick: () => removeSchool(sc, count(sc.id)) }, '삭제') : null,
            ),
          ))),
        )),
      ),
      h('section', { class: 'card form' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '➕'), '학교 추가'),
        h('label', { class: 'field' }, h('span', null, '학교 이름'), nameIn),
        h('label', { class: 'field' }, h('span', null, '그 학교 선생님 비밀번호'), pwIn,
          h('small', { class: 'muted' }, '추가한 뒤 이 비밀번호를 그 학교 선생님께 알려 주세요. 그 선생님은 선생님 페이지에서 학교를 고르고 이 비밀번호로 들어가 학생 등록과 대결 열기·닫기를 직접 할 수 있어요(게임 설정·초기화는 할 수 없어요). 비밀번호는 그 선생님이 나중에 바꿀 수 있어요.')),
        h('button', { class: 'btn btn-primary', onclick: () => addSchool(nameIn.value, pwIn.value) }, '학교 추가'),
      ),
    );
  }

  async function addSchool(rawName, pw) {
    const name = String(rawName || '').trim();
    if (!name) return toast('학교 이름을 입력해 주세요.', 'warn');
    if (schoolList().some((sc) => normalizeName(sc.name) === normalizeName(name))) return toast('이미 있는 학교 이름이에요.', 'warn');
    if (!pw || pw.length < 4) return toast('선생님 비밀번호는 4글자 이상으로 해 주세요.', 'warn');
    const sid = 's' + db.newKey();
    await db.update('', { [`schools/${sid}`]: { name, createdAt: db.now() }, [teacherPath(sid)]: await makeSecret(pw) });
    toast(`${name} 학교를 추가했어요. 비밀번호를 그 학교 선생님께 알려 주세요.`, 'ok', 4500);
    renderMain();
  }

  async function renameSchool(sc) {
    const v = await promptBox('학교 이름 바꾸기', [{ name: 'name', label: '학교 이름', value: sc.name }], '저장');
    if (!v) return;
    const name = String(v.name || '').trim();
    if (!name) return toast('학교 이름을 입력해 주세요.', 'warn');
    if (schoolList().some((x) => x.id !== sc.id && normalizeName(x.name) === normalizeName(name))) return toast('이미 있는 학교 이름이에요.', 'warn');
    await db.update(`schools/${sc.id}`, { name });
    toast('저장했어요.', 'ok');
    renderMain();
  }

  async function resetSchoolPw(sc) {
    const v = await promptBox(`${sc.name} 선생님 비밀번호 새로 정하기`, [{ name: 'pw', label: '새 비밀번호', type: 'text' }], '바꾸기');
    if (!v) return;
    if (v.pw.length < 4) return toast('비밀번호는 4글자 이상으로 해 주세요.', 'warn');
    await db.set(teacherPath(sc.id), await makeSecret(v.pw));
    toast(`${sc.name} 선생님 비밀번호를 바꿨어요.`, 'ok');
  }

  async function removeSchool(sc, students) {
    if (students > 0) return toast('학생이 있는 학교는 지울 수 없어요. 그 학교 선생님이 먼저 학생을 지워야 해요.', 'warn', 4000);
    if (!(await confirmBox('학교 삭제', `${sc.name} 학교를 목록에서 지울까요?`, '삭제', 'danger'))) return;
    await db.update('', { [`schools/${sc.id}`]: null, [teacherPath(sc.id)]: null, [battlePath(sc.id)]: null });
    toast('삭제했어요.');
    renderMain();
  }

  // ───────── 시즌 ─────────
  function drawSeason(el) {
    const cur = currentSeason();
    const past = pastSeasons();
    const liveCount = Object.keys(store.live || {}).length;
    const newSeasonUntouched = Object.values(store.users).every((u) => !(u.wins || u.losses));
    const lastN = cur - 1;
    el.append(
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🏁'), `지금은 시즌 ${cur}`),
        h('p', { class: 'muted small' }, `${seasonPeriodText(cur)}. 시즌을 마치면 그때의 최종 기록(티어·순위·승패·승수 순위)을 보관하고 다음 시즌을 새로 시작해요. 새 시즌에는 ${multiSchool() ? '모든 학교 ' : ''}학생이 1000점, 0승 0패에서 배치고사부터 다시 해요. 대결 기록은 지우지 않고 시즌별로 볼 수 있어요.`),
        admin ? h('div', { class: 'row-gap' },
          h('button', { class: 'btn btn-primary', disabled: liveCount > 0, onclick: endSeason }, `🏁 시즌 ${cur} 마치고 시즌 ${cur + 1} 시작`),
          liveCount ? h('span', { class: 'muted small' }, `진행 중인 대결 ${liveCount}개가 끝나야 시즌을 마칠 수 있어요.`) : null,
        ) : h('p', { class: 'muted small' }, `시즌을 마치는 것은 ${schoolName(MAIN)} 선생님이 해요.`),
        admin && lastN >= 1 && seasonData(lastN) && newSeasonUntouched ? h('div', { class: 'row-gap' },
          h('button', { class: 'btn', onclick: undoSeason }, `↩️ 시즌 ${lastN} 마치기 되돌리기`),
          h('span', { class: 'muted small' }, `시즌 ${cur}에서 아직 아무도 대결하지 않았을 때만 되돌릴 수 있어요.`),
        ) : null,
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '📚'), '지난 시즌 기록'),
        past.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['시즌', '기간', '참가', ''].map((t) => h('th', null, t)))),
          h('tbody', null, past.map((n) => h('tr', null,
            h('td', null, h('b', null, `시즌 ${n}`)),
            h('td', null, seasonPeriodText(n)),
            h('td', null, `${Object.keys(seasonData(n)?.players || {}).filter((u) => admin || seasonPlayerSchool(n, u) === tsid).length}명`),
            h('td', { class: 'actions' },
              h('a', { class: 'btn btn-small', href: `#/ranking/${seasonKey(n)}` }, '🏆 최종 랭킹 보기'),
              h('button', { class: 'btn btn-small', onclick: () => exportSeasonCsv(n) }, '📥 CSV'),
            ),
          ))),
        )) : h('p', { class: 'empty' }, '아직 마친 시즌이 없어요.'),
      ),
    );
  }

  function seasonPlayerSchool(n, uid) {
    return seasonData(n)?.players?.[uid]?.school || MAIN;
  }

  async function endSeason() {
    const n = currentSeason();
    if (Object.keys(store.live || {}).length) return toast('진행 중인 대결이 끝난 뒤에 시즌을 마칠 수 있어요.', 'warn');
    const v = await promptBox(`시즌 ${n} 마치기`, [{ name: 'word', label: `확인을 위해 "시즌${n}"이라고 입력하세요` }], '시즌 마치기',
      `시즌 ${n} 최종 기록을 보관하고 시즌 ${n + 1}을 시작해요. ${multiSchool() ? '모든 학교 ' : ''}학생의 점수가 1000점, 0승 0패가 되고 배치고사부터 다시 해요. 대결 기록은 지워지지 않아요. ${multiSchool() ? '모든 학교의 ' : ''}대결은 닫혀요.`);
    if (!v || String(v.word).replace(/\s/g, '') !== `시즌${n}`) return;
    const now = db.now();
    const snap = buildSeasonSnapshot(store.users, store.settings, n, store.season?.startedAt || null, now);
    const up = {
      [`seasons/${seasonKey(n)}`]: snap,
      'config/season': { current: n + 1, startedAt: now },
      builds: null, live: null, active: null, invites: null, queue: null,
    };
    for (const uid of Object.keys(store.users)) {
      up[`users/${uid}/rating`] = START_RATING;
      up[`users/${uid}/wins`] = 0;
      up[`users/${uid}/losses`] = 0;
    }
    for (const sc of schoolList()) up[battlePath(sc.id)] = { open: false, at: now };
    await db.update('', up);
    toast(`시즌 ${n} 기록을 보관하고 시즌 ${n + 1}을 시작했어요.`, 'ok', 4000);
    renderMain();
  }

  async function undoSeason() {
    const n = currentSeason() - 1;
    const snap = seasonData(n);
    if (!snap) return;
    if (!Object.values(store.users).every((u) => !(u.wins || u.losses))) return toast(`시즌 ${n + 1}에서 이미 대결한 학생이 있어서 되돌릴 수 없어요.`, 'warn');
    if (!(await confirmBox('시즌 마치기 되돌리기', `시즌 ${n + 1}을 없애고 시즌 ${n}의 점수·승패로 되돌릴까요?`, '되돌리기', 'danger'))) return;
    const up = {
      [`seasons/${seasonKey(n)}`]: null,
      'config/season': n === 1 && !snap.startedAt ? null : { current: n, startedAt: snap.startedAt || null },
    };
    for (const [uid, p] of Object.entries(snap.players || {})) {
      if (!store.users[uid]) continue;
      up[`users/${uid}/rating`] = p.rating;
      up[`users/${uid}/wins`] = p.wins || 0;
      up[`users/${uid}/losses`] = p.losses || 0;
    }
    await db.update('', up);
    toast(`시즌 ${n}으로 되돌렸어요.`, 'ok');
    renderMain();
  }

  // 지난 시즌 최종 기록 CSV (다른 학교 선생님은 자기 학교 학생만)
  function exportSeasonCsv(n) {
    const st = seasonStandings(n);
    if (!st) return;
    const multi = multiSchool();
    const rows = [['번호', '이름', ...(multi && admin ? ['학교'] : []), '티어', '티어 순위', '점수', '승', '패', '승률', '승수 순위']];
    const winRankOf = Object.fromEntries(Object.entries(seasonData(n).players || {}).map(([u, p]) => [u, p.winRank]));
    for (const s of st.list) {
      const sid = s.school || MAIN;
      if (!admin && sid !== tsid) continue;
      rows.push([s.no ?? '', s.name, ...(multi && admin ? [schoolName(sid)] : []), s.ranked ? s.tier.name : '배치고사 미완료', s.ranked ? s.rank + 1 : '',
        s.rating, s.wins, s.losses, formatWinRate(s.wins, s.losses), winRankOf[s.uid] != null ? winRankOf[s.uid] + 1 : '']);
    }
    const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `쌓기나무배틀_시즌${n}${multi && !admin ? '_' + schoolName(tsid) : ''}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ───────── 비밀번호 (다른 학교 선생님) ─────────
  function drawAccount(el) {
    el.append(h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🔑'), '선생님 비밀번호 바꾸기'),
      h('p', { class: 'muted small' }, `게임 설정·학교 추가·초기화는 ${schoolName(MAIN)} 선생님이 관리해요.`),
      h('button', { class: 'btn', onclick: changeTeacherPw }, '바꾸기'),
    ));
  }

  // ───────── 초기화·체험 ─────────
  function drawReset(el) {
    const sampleSchool = multiSchool() ? h('select', { class: 'inline-select' }, schoolList().map((sc) => h('option', { value: sc.id }, sc.name))) : null;
    el.append(
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🧪'), '체험용 도구'),
        h('p', { class: 'muted small' }, '수업 전에 미리 해 보고 싶을 때 쓰세요. 다 해 본 뒤에는 "모든 데이터 지우기"로 정리할 수 있어요.'),
        h('div', { class: 'row-gap' },
          sampleSchool,
          h('button', { class: 'btn', onclick: () => makeSamples(sampleSchool ? sampleSchool.value : tsid) }, '체험용 학생 25명 만들기 (비밀번호 1234)'),
          h('button', { class: 'btn', onclick: randomizeScores }, '무작위 점수로 티어 미리 보기'),
        ),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🔄'), '시즌 초기화'),
        h('p', { class: 'muted small' }, '학생 계정과 비밀번호는 그대로 두고, 점수·전적·티어만 처음으로 돌립니다.'),
        h('button', { class: 'btn btn-danger', onclick: seasonReset }, '점수·전적 초기화'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🗑️'), '모든 데이터 지우기'),
        h('p', { class: 'muted small' }, '학생 계정까지 모두 지웁니다. 선생님 비밀번호는 남아요.'),
        h('button', { class: 'btn btn-danger', onclick: wipeAll }, '모두 지우기'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, h('span', { class: 'title-icon' }, '🔑'), '선생님 비밀번호 바꾸기'),
        h('button', { class: 'btn', onclick: changeTeacherPw }, '바꾸기'),
      ),
    );
  }

  async function typedConfirm(title, text) {
    const v = await promptBox(title, [{ name: 'word', label: '확인을 위해 "초기화"라고 입력하세요' }], '실행', text);
    return v && v.word.trim() === '초기화';
  }

  async function makeSamples(sid = tsid) {
    const existing = new Set(Object.entries(store.users).filter(([uid]) => schoolOf(uid) === sid).map(([, u]) => normalizeName(u.name)));
    const lines = SAMPLE_NAMES.map((n, i) => (existing.has(n) ? null : `${i + 1} ${n} 1234`)).filter(Boolean);
    if (!lines.length) return toast('체험용 학생이 이미 있어요.');
    await addStudents(lines.join('\n'), sid);
  }

  async function randomizeScores() {
    if (!(await confirmBox('무작위 점수', '모든 학생의 점수와 승패를 무작위로 바꿔요. (전적 목록은 바뀌지 않아요) 진짜 수업 중이라면 하지 마세요!', '바꾸기', 'danger'))) return;
    const up = {};
    for (const uid of Object.keys(store.users)) {
      const w = Math.floor(Math.random() * 10), l = Math.floor(Math.random() * 10);
      up[`users/${uid}/wins`] = w + 2;
      up[`users/${uid}/losses`] = l + 1;
      up[`users/${uid}/rating`] = START_RATING + (w - l) * 16 + Math.floor(Math.random() * 20);
    }
    await db.update('', up);
    toast('무작위 점수를 넣었어요. 랭킹에서 확인해 보세요.', 'ok');
  }

  async function seasonReset() {
    if (!(await typedConfirm('점수·전적 초기화', `${multiSchool() ? '모든 학교의 ' : ''}모든 학생의 점수가 1000점, 0승 0패로 돌아가고 전적이 지워져요. (지난 시즌 기록 보관함은 그대로예요. 기록을 남기고 새로 시작하려면 '시즌' 탭의 시즌 마치기를 쓰세요.)`))) return;
    const up = { history: null, games: null, builds: null, live: null, active: null, invites: null, queue: null };
    for (const uid of Object.keys(store.users)) {
      up[`users/${uid}/rating`] = START_RATING;
      up[`users/${uid}/wins`] = 0;
      up[`users/${uid}/losses`] = 0;
    }
    await db.update('', up);
    toast('시즌을 초기화했어요.', 'ok');
  }

  async function wipeAll() {
    if (!(await typedConfirm('모든 데이터 지우기', `${multiSchool() ? '모든 학교의 ' : ''}학생 계정, 점수, 전적, 지난 시즌 기록이 모두 지워져요. (학교 목록과 선생님 비밀번호는 남아요)`))) return;
    await db.update('', {
      users: null, secrets: null, history: null, games: null, builds: null, live: null,
      active: null, invites: null, presence: null, queue: null, 'config/settings': null, 'config/battle': null, 'config/battles': null, keys: null,
      seasons: null, 'config/season': null,
    });
    toast('모두 지웠어요.', 'ok');
  }

  async function changeTeacherPw() {
    const v = await promptBox('선생님 비밀번호 바꾸기', [
      { name: 'old', label: '지금 비밀번호', type: 'password' },
      { name: 'pw1', label: '새 비밀번호', type: 'password' },
      { name: 'pw2', label: '새 비밀번호 확인', type: 'password' },
    ], '바꾸기');
    if (!v) return;
    if (!(await checkSecret(await db.get(teacherPath(tsid)), v.old))) return toast('지금 비밀번호가 맞지 않아요.', 'error');
    if (v.pw1.length < 4 || v.pw1 !== v.pw2) return toast('새 비밀번호를 확인해 주세요 (4글자 이상, 두 번 똑같이).', 'warn');
    await db.set(teacherPath(tsid), await makeSecret(v.pw1));
    toast('바꿨어요.', 'ok');
  }

  start();
  return () => { off && off(); };
}
