import { h, toast } from '../ui.js';
import { db } from '../db.js';
import { store, subscribe } from '../store.js';
import { loginStudent } from '../auth.js';
import { startSession, go } from '../session.js';
import { schoolList, multiSchool } from '../schools.js';

const LAST_SCHOOL_KEY = 'namubattle-school';

export function mount(root) {
  // 학교가 여러 개면 학교부터 고르기 (같은 이름의 학생이 다른 학교에 있을 수 있어요)
  let school = null;
  try { school = localStorage.getItem(LAST_SCHOOL_KEY); } catch { /* 무시 */ }
  const schoolBox = h('div', { class: 'field' });
  function renderSchools() {
    schoolBox.innerHTML = '';
    const list = schoolList();
    schoolBox.hidden = !multiSchool();
    if (!multiSchool()) { school = null; return; }
    if (!list.some((sc) => sc.id === school)) school = null;
    schoolBox.append(
      h('span', null, '학교'),
      h('div', { class: 'school-pick', role: 'group', 'aria-label': '학교 고르기' }, list.map((sc, i) => h('button', {
        type: 'button',
        class: `school-pick-btn sc-${i % 4} ${school === sc.id ? 'on' : ''}`,
        'aria-pressed': school === sc.id ? 'true' : 'false',
        onclick: () => {
          school = sc.id;
          try { localStorage.setItem(LAST_SCHOOL_KEY, school); } catch { /* 무시 */ }
          renderSchools();
        },
      }, sc.name))),
    );
  }
  renderSchools();
  const offSchools = subscribe((_, what) => { if (what === 'schools') renderSchools(); });

  const nameInput = h('input', { type: 'text', id: 'login-name', autocomplete: 'off', placeholder: '예: 주채훈', required: true });
  const pwInput = h('input', { type: 'password', id: 'login-pw', autocomplete: 'off', placeholder: '비밀번호', required: true, inputmode: 'text' });

  const btn = h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, '입장하기');
  const form = h('form', { class: 'card login-card', onsubmit: async (e) => {
    e.preventDefault();
    if (multiSchool() && !school) {
      toast('먼저 학교를 골라 주세요.', 'warn');
      return;
    }
    btn.disabled = true;
    try {
      const uid = await loginStudent(nameInput.value, pwInput.value, multiSchool() ? school : null);
      await startSession(uid);
      toast(`${store.users[uid]?.name || ''} 어서 와요!`, 'ok');
      go('#/lobby');
    } catch (err) {
      toast(err.message || '로그인하지 못했어요.', 'error', 3500);
      pwInput.select();
    } finally {
      btn.disabled = false;
    }
  } },
    h('div', { class: 'login-title' },
      h('h2', null, '⚔️ 대결장 입장'),
      h('p', { class: 'muted' }, '이름과 비밀번호를 입력하세요'),
    ),
    schoolBox,
    h('label', { class: 'field' }, h('span', null, '이름'), nameInput),
    h('label', { class: 'field' }, h('span', null, '비밀번호'), pwInput),
    btn,
    h('div', { class: 'login-links' },
      h('a', { href: '#/ranking' }, '🏆 랭킹 보기'),
      h('a', { href: '#/teacher' }, '👩‍🏫 선생님 페이지'),
    ),
  );

  root.appendChild(h('div', { class: 'login-page' },
    db.mode === 'local' ? h('div', { class: 'demo-banner' },
      h('b', null, '체험 모드'), ' — Firebase가 아직 연결되지 않아 이 브라우저 안에서만 저장돼요. ',
      '선생님 페이지에서 체험용 학생을 만들고, 탭 두 개로 두 학생이 되어 대결해 보세요.',
    ) : null,
    h('div', { class: 'login-layout' },
      h('div', { class: 'hero-banner' },
        h('img', {
          src: 'img/hero.webp', width: '1672', height: '940', decoding: 'async', fetchpriority: 'high',
          alt: '쌓기나무 배틀 — 주어진 조건에 맞게 쌓기나무를 빠르게 쌓아라! 동평초와 대서초의 쌓기나무 대결',
        }),
      ),
      form,
    ),
  ));
  // 태블릿에서는 자동으로 키보드가 올라와 그림을 가리지 않도록, 마우스가 있는 기기에서만 자동 포커스
  if (window.matchMedia?.('(pointer: fine)').matches) setTimeout(() => nameInput.focus(), 50);
  return () => offSchools();
}
