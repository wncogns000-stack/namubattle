// 선생님 페이지: 학생 등록, 비밀번호 초기화, 진행 중인 대결 관리, 설정, 초기화
import { h, toast, confirmBox, promptBox, tierBadge, fmtDuration } from '../ui.js';
import { db } from '../db.js';
import { store, subscribe, isOnline } from '../store.js';
import { DEFAULT_SETTINGS, LEVELS, START_RATING, TIERS } from '../config.js';
import { formatWinRate } from '../tiers.js';
import { teacherExists, setupTeacher, loginTeacher, isTeacher, logoutTeacher, makeSecret, normalizeName, checkSecret } from '../auth.js';
import { cancelGame } from '../match.js';

const SAMPLE_NAMES = ['민준', '서연', '도윤', '하은', '시우', '지우', '주원', '서윤', '하준', '지민', '예준', '수아', '유준',
  '하린', '은우', '지아', '건우', '다은', '우진', '채원', '선우', '윤서', '현우', '소율', '지호'];

export function mount(root) {
  const box = h('div', { class: 'page teacher-page' });
  root.appendChild(box);
  let tab = 'students';
  let off = null;

  async function start() {
    box.innerHTML = '';
    if (isTeacher()) return renderMain();
    const exists = await teacherExists();
    const pw = h('input', { type: 'password', autocomplete: 'off', placeholder: '선생님 비밀번호' });
    const pw2 = h('input', { type: 'password', autocomplete: 'off', placeholder: '한 번 더' });
    const form = h('form', { class: 'card login-card', onsubmit: async (e) => {
      e.preventDefault();
      try {
        if (!exists) {
          if (pw.value.length < 4) throw new Error('비밀번호는 4글자 이상으로 해 주세요.');
          if (pw.value !== pw2.value) throw new Error('두 비밀번호가 달라요.');
          await setupTeacher(pw.value);
          toast('선생님 비밀번호를 만들었어요.', 'ok');
        } else {
          await loginTeacher(pw.value);
        }
        renderMain();
      } catch (err) {
        toast(err.message, 'error');
      }
    } },
      h('h2', null, '👩‍🏫 선생님 페이지'),
      exists ? h('p', { class: 'muted' }, '선생님 비밀번호를 입력하세요.')
        : h('p', { class: 'muted' }, '처음 오셨네요! 선생님 비밀번호를 만들어 주세요. 학생 등록과 관리에 쓰여요.'),
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
    const content = h('div');
    const tabs = [
      ['students', '학생 관리'],
      ['live', '진행 중인 대결'],
      ['settings', '게임 설정'],
      ['reset', '초기화·체험'],
    ];
    const tabBar = h('div', { class: 'tabs' }, tabs.map(([k, label]) => h('button', {
      class: `tab ${tab === k ? 'on' : ''}`,
      onclick: () => { tab = k; renderMain(); },
    }, label)));
    box.innerHTML = '';
    box.append(
      h('div', { class: 'card teacher-head' },
        h('h2', null, '👩‍🏫 선생님 페이지'),
        h('span', { class: 'muted' }, db.mode === 'local' ? '체험 모드 (이 브라우저에만 저장)' : 'Firebase 연결됨'),
        h('button', { class: 'btn btn-small', onclick: () => { logoutTeacher(); start(); } }, '나가기'),
      ),
      tabBar,
      content,
    );
    const draw = () => {
      content.innerHTML = '';
      ({ students: drawStudents, live: drawLive, settings: drawSettings, reset: drawReset })[tab](content);
    };
    draw();
    off = subscribe((_, what) => {
      if (tab === 'settings') return; // 입력 중인 값이 지워지지 않도록
      if (tab === 'reset') return;
      if (what === 'presence' && tab !== 'live' && tab !== 'students') return;
      if (document.activeElement && content.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
      draw();
    });
  }

  // ───────── 학생 관리 ─────────
  function drawStudents(el) {
    const list = [...store.standings.list].sort((a, b) => (a.no ?? 999) - (b.no ?? 999) || String(a.name).localeCompare(String(b.name), 'ko'));
    const ta = h('textarea', { rows: 6, placeholder: '한 줄에 한 명씩: 번호 이름 비밀번호\n예)\n1 김민준 1234\n2 이서연 5678' });
    el.append(
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, `학생 목록 (${list.length}명)`),
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
        h('h3', { class: 'card-title' }, '학생 등록'),
        h('p', { class: 'muted small' }, '번호·이름·비밀번호를 띄어쓰기, 쉼표 또는 탭으로 구분해 붙여 넣으세요. 엑셀에서 세 칸을 복사해 붙여 넣어도 돼요. 이름이 같은 학생이 있으면 "김민준A"처럼 구분해 주세요. 비밀번호는 4글자 이상.'),
        ta,
        h('button', { class: 'btn btn-primary', onclick: () => addStudents(ta.value).then((ok) => { if (ok) ta.value = ''; }) }, '등록하기'),
      ),
    );
  }

  async function addStudents(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return toast('등록할 학생을 입력해 주세요.', 'warn');
    const existing = new Set(Object.values(store.users).map((u) => normalizeName(u.name)));
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
        up[`users/${uid}`] = { name: r.name, no: r.no, rating: START_RATING, wins: 0, losses: 0, createdAt: db.now() };
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
    const dup = Object.entries(store.users).some(([uid, u]) => uid !== s.uid && normalizeName(u.name) === name);
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
    for (const s of store.standings.list) {
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
    const online = store.standings.list.filter((s) => isOnline(s.uid));
    el.append(
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, `진행 중인 대결 (${games.length})`),
        games.length ? h('ul', { class: 'player-list' }, games.map(([gid, g]) => {
          const names = Object.values(g.players || {});
          return h('li', { class: 'player-row' },
            h('b', null, `${names[0]} vs ${names[1]}`),
            h('span', { class: 'player-meta' }, `${LEVELS[g.level]?.name || ''} · ${fmtDuration(db.now() - (g.createdAt || db.now()))} 지남`),
            h('button', { class: 'btn btn-small btn-danger', onclick: async () => {
              if (await confirmBox('대결 무효', `${names[0]} vs ${names[1]} 대결을 무효로 끝낼까요? 점수에 반영되지 않아요.`, '무효 처리', 'danger')) {
                await cancelGame(gid, 'teacher');
                await db.remove(`live/${gid}`);
                toast('무효 처리했어요.');
              }
            } }, '무효 처리'),
          );
        })) : h('p', { class: 'empty' }, '진행 중인 대결이 없어요.'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, `접속 중인 학생 (${online.length})`),
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
    const level = sel([[0, '자동 (티어에 따라)'], ...Object.entries(LEVELS).map(([k, L]) => [k, `${L.name} 고정 (${L.n}×${L.n}, ${L.maxH}층, ${L.count[0]}~${L.count[1]}개)`])], s.level);
    el.append(h('section', { class: 'card form' },
      h('h3', { class: 'card-title' }, '게임 설정'),
      h('label', { class: 'field' }, h('span', null, '대결할 수 있는 티어 차이'), gap,
        h('small', { class: 'muted' }, `예: 2단계 → 골드는 에메랄드·플래티넘·골드·실버·브론즈와 대결 가능. 티어 순서: ${TIERS.map((t) => t.name).join(' > ')}`)),
      h('label', { class: 'field' }, h('span', null, '배치고사 판수'), placement,
        h('small', { class: 'muted' }, '배치고사 중에는 누구와도 대결할 수 있고, 다 마치면 점수 순위로 티어가 정해져요.')),
      h('label', { class: 'field' }, h('span', null, '틀렸을 때 넘어간 기회가 다시 열리는 시간'), timeout,
        h('small', { class: 'muted' }, '상대가 일부러 도전하지 않고 시간을 끄는 것을 막고 싶을 때 정하세요.')),
      h('label', { class: 'field' }, h('span', null, '문제 난이도'), level),
      h('div', { class: 'row-gap' },
        h('button', { class: 'btn btn-primary', onclick: async () => {
          await db.set('config/settings', {
            tierGap: Number(gap.value), placementGames: Number(placement.value),
            passTimeoutSec: Number(timeout.value), level: Number(level.value),
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

  // ───────── 초기화·체험 ─────────
  function drawReset(el) {
    el.append(
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, '체험용 도구'),
        h('p', { class: 'muted small' }, '수업 전에 미리 해 보고 싶을 때 쓰세요. 다 해 본 뒤에는 "모든 데이터 지우기"로 정리할 수 있어요.'),
        h('div', { class: 'row-gap' },
          h('button', { class: 'btn', onclick: makeSamples }, '체험용 학생 25명 만들기 (비밀번호 1234)'),
          h('button', { class: 'btn', onclick: randomizeScores }, '무작위 점수로 티어 미리 보기'),
        ),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, '시즌 초기화'),
        h('p', { class: 'muted small' }, '학생 계정과 비밀번호는 그대로 두고, 점수·전적·티어만 처음으로 돌립니다.'),
        h('button', { class: 'btn btn-danger', onclick: seasonReset }, '점수·전적 초기화'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, '모든 데이터 지우기'),
        h('p', { class: 'muted small' }, '학생 계정까지 모두 지웁니다. 선생님 비밀번호는 남아요.'),
        h('button', { class: 'btn btn-danger', onclick: wipeAll }, '모두 지우기'),
      ),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, '선생님 비밀번호 바꾸기'),
        h('button', { class: 'btn', onclick: changeTeacherPw }, '바꾸기'),
      ),
    );
  }

  async function typedConfirm(title, text) {
    const v = await promptBox(title, [{ name: 'word', label: '확인을 위해 "초기화"라고 입력하세요' }], '실행', text);
    return v && v.word.trim() === '초기화';
  }

  async function makeSamples() {
    const existing = new Set(Object.values(store.users).map((u) => normalizeName(u.name)));
    const lines = SAMPLE_NAMES.map((n, i) => (existing.has(n) ? null : `${i + 1} ${n} 1234`)).filter(Boolean);
    if (!lines.length) return toast('체험용 학생이 이미 있어요.');
    await addStudents(lines.join('\n'));
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
    if (!(await typedConfirm('점수·전적 초기화', '모든 학생의 점수가 1000점, 0승 0패로 돌아가고 전적이 지워져요.'))) return;
    const up = { history: null, games: null, builds: null, live: null, active: null, invites: null };
    for (const uid of Object.keys(store.users)) {
      up[`users/${uid}/rating`] = START_RATING;
      up[`users/${uid}/wins`] = 0;
      up[`users/${uid}/losses`] = 0;
    }
    await db.update('', up);
    toast('시즌을 초기화했어요.', 'ok');
  }

  async function wipeAll() {
    if (!(await typedConfirm('모든 데이터 지우기', '학생 계정, 점수, 전적이 모두 지워져요.'))) return;
    await db.update('', {
      users: null, secrets: null, history: null, games: null, builds: null, live: null,
      active: null, invites: null, presence: null, 'config/settings': null, keys: null,
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
    if (!(await checkSecret(await db.get('config/teacher'), v.old))) return toast('지금 비밀번호가 맞지 않아요.', 'error');
    if (v.pw1.length < 4 || v.pw1 !== v.pw2) return toast('새 비밀번호를 확인해 주세요 (4글자 이상, 두 번 똑같이).', 'warn');
    await db.set('config/teacher', await makeSecret(v.pw1));
    toast('바꿨어요.', 'ok');
  }

  start();
  return () => { off && off(); };
}
