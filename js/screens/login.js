import { h, toast } from '../ui.js';
import { db } from '../db.js';
import { store } from '../store.js';
import { loginStudent } from '../auth.js';
import { startSession, go } from '../session.js';

export function mount(root) {
  const nameInput = h('input', { type: 'text', id: 'login-name', autocomplete: 'off', placeholder: '예: 주채훈', required: true });
  const pwInput = h('input', { type: 'password', id: 'login-pw', autocomplete: 'off', placeholder: '비밀번호', required: true, inputmode: 'text' });

  const btn = h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, '입장하기');
  const form = h('form', { class: 'card login-card', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      const uid = await loginStudent(nameInput.value, pwInput.value);
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
          src: 'img/hero.webp', width: '1672', height: '941', decoding: 'async', fetchpriority: 'high',
          alt: '쌓기나무 배틀 — 6-2 양반후반 최강 쌓기왕을 가려라! 양념치킨과 후라이드치킨의 쌓기나무 대결',
        }),
      ),
      form,
    ),
  ));
  // 태블릿에서는 자동으로 키보드가 올라와 그림을 가리지 않도록, 마우스가 있는 기기에서만 자동 포커스
  if (window.matchMedia?.('(pointer: fine)').matches) setTimeout(() => nameInput.focus(), 50);
}
