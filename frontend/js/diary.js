const API = (window.location.protocol === 'file:' || window.location.port === '5173')
  ? `http://${window.location.hostname || '127.0.0.1'}:8000/api`
  : '/api';
const MEDIA_BASE = (window.location.protocol === 'file:' || window.location.port === '5173')
  ? `http://${window.location.hostname || '127.0.0.1'}:8000`
  : '';
let token = localStorage.getItem('diary_token');
let user = null;
let current = null;
let activeCategoryId = null;
let activeCategoryName = '';
let splitDate = null;
let splittingPage = false;
let saveTimer;
let savedEditorRange = null;
let allTodayPages = [];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const parseDate = (d) => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  let str = String(d).trim();
  if (str && !str.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(str)) {
    str += 'Z';
  }
  return new Date(str);
};
const localDateKey = (date) => {
  const value = parseDate(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let toastTimer = null;
const toast = (message) => {
  const element = $('#toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.classList.remove('show');
  }, 2600);
};

async function api(path, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  } else if (isFormData) {
    delete headers['Content-Type'];
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API + path, { ...options, headers });
  if (response.status === 401 && token && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    token = null;
    localStorage.removeItem('diary_token');
    toast('Session expired. Please sign in again.');
    setTimeout(() => location.reload(), 1500);
    throw Error('Session expired');
  }
  if (!response.ok) {
    let error = {};
    try { error = await response.json(); } catch {}
    throw Error(error.detail || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function getAvatarUrl(url) {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${MEDIA_BASE}${url}`;
  return `${MEDIA_BASE}/${url}`;
}

function applyUserAvatar(avatarUrl) {
  const sidebarAvatar = $('#userAvatar');
  const brandBadge = $('#brandBadge');
  const settingsAvatar = $('#settingsAvatarPreview');
  const settingsBadge = $('#settingsAvatarBadge');

  if (avatarUrl) {
    const fullUrl = getAvatarUrl(avatarUrl);
    if (sidebarAvatar) {
      sidebarAvatar.src = fullUrl;
      sidebarAvatar.classList.remove('hidden');
      sidebarAvatar.onerror = () => {
        sidebarAvatar.classList.add('hidden');
        if (brandBadge) brandBadge.classList.remove('hidden');
      };
    }
    if (brandBadge) brandBadge.classList.add('hidden');

    if (settingsAvatar) {
      settingsAvatar.src = fullUrl;
      settingsAvatar.classList.remove('hidden');
      settingsAvatar.onerror = () => {
        settingsAvatar.classList.add('hidden');
        if (settingsBadge) settingsBadge.classList.remove('hidden');
      };
    }
    if (settingsBadge) settingsBadge.classList.add('hidden');
  } else {
    if (sidebarAvatar) {
      sidebarAvatar.src = '';
      sidebarAvatar.classList.add('hidden');
    }
    if (brandBadge) brandBadge.classList.remove('hidden');

    if (settingsAvatar) {
      settingsAvatar.src = '';
      settingsAvatar.classList.add('hidden');
    }
    if (settingsBadge) settingsBadge.classList.remove('hidden');
  }
}

async function uploadUserAvatar(file) {
  if (!file) return;
  toast('Uploading photo...');
  try {
    let newAvatarUrl = null;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api('/auth/avatar', {
        method: 'POST',
        body: formData
      });
      if (res && res.avatar_url) {
        newAvatarUrl = res.avatar_url;
      }
    } catch (uploadErr) {
      console.warn('Multipart avatar upload failed, trying base64 fallback:', uploadErr);
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const patchRes = await api('/auth/settings', {
        method: 'PATCH',
        body: JSON.stringify({ avatar_url: base64Data })
      });
      if (patchRes && patchRes.avatar_url) {
        newAvatarUrl = patchRes.avatar_url;
      }
    }

    if (newAvatarUrl) {
      user = { ...user, avatar_url: newAvatarUrl };
      applyUserAvatar(newAvatarUrl);
      toast('Profile photo updated ✦');
    } else {
      throw new Error('Photo upload could not be completed');
    }
  } catch (err) {
    console.error('Avatar upload failed:', err);
    toast(err.message || 'Photo upload failed');
  }
}

function authForm(mode = 'login') {
  if (mode === 'login') {
    $('#authForm').innerHTML = `
      <input name="username" placeholder="Username" required autocomplete="username">
      <input name="password" type="password" placeholder="Password" required autocomplete="current-password">
      <div style="display:flex;justify-content:flex-end;margin-top:-6px;margin-bottom:2px">
        <button type="button" id="forgotLink" class="auth-link">Forgot password?</button>
      </div>
      <p id="authError" class="auth-error" role="alert"></p>
      <button class="primary" type="submit">Sign in</button>
      <button type="button" class="secondary" id="toRegisterBtn">Create account</button>
    `;
    $('#forgotLink').onclick = () => authForm('forgot');
    $('#toRegisterBtn').onclick = () => authForm('register');
    $('#authForm').onsubmit = async (event) => {
      event.preventDefault();
      $('#authError').textContent = '';
      const data = Object.fromEntries(new FormData(event.target));
      try {
        const result = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: data.username, password: data.password })
        });
        token = result.access_token;
        localStorage.setItem('diary_token', token);
        user = result.user;
        const needsOnboarding = !user.gender || !user.age_range;
        if (!needsOnboarding) {
          boot(false, true);
        } else {
          $('#auth').classList.add('hidden');
          showOnboarding('gender');
        }
      } catch (error) {
        $('#authError').textContent = 'Invalid username or password';
      }
    };
    return;
  }

  if (mode === 'register') {
    $('#authForm').innerHTML = `
      <input name="email" type="email" placeholder="Email" required autocomplete="email">
      <input name="username" placeholder="Username" required autocomplete="username">
      <input name="password" type="password" placeholder="Password (8+ characters)" required autocomplete="new-password">
      <input name="question" placeholder="Recovery question (e.g. Pet's name?)" required>
      <input name="answer" placeholder="Recovery answer" required>
      <p id="authError" class="auth-error" role="alert"></p>
      <button class="primary" type="submit">Create account</button>
      <button type="button" class="secondary" id="toLoginBtn">Already have an account? Sign in</button>
    `;
    $('#toLoginBtn').onclick = () => authForm('login');
    $('#authForm').onsubmit = async (event) => {
      event.preventDefault();
      $('#authError').textContent = '';
      const data = Object.fromEntries(new FormData(event.target));
      try {
        const result = await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username: data.username,
            email: data.email,
            password: data.password,
            recovery_question: data.question,
            recovery_answer: data.answer
          })
        });
        token = result.access_token;
        localStorage.setItem('diary_token', token);
        user = result.user;
        $('#auth').classList.add('hidden');
        showOnboarding('gender');
      } catch (error) {
        $('#authError').textContent = error.message;
      }
    };
    return;
  }

  if (mode === 'forgot') {
    $('#authForm').innerHTML = `
      <input name="username" id="forgotUsername" placeholder="Enter your username" required autocomplete="username">
      <div id="recoveryStep" class="hidden" style="display:grid;gap:12px">
        <p id="recoveryPrompt" style="margin:4px 0;font:13px Arial;color:var(--rose-dark);font-weight:600"></p>
        <input name="answer" id="recoveryAnswer" placeholder="Your recovery answer" autocomplete="off">
        <input name="new_password" id="newPassword" type="password" placeholder="New password (8+ characters)" autocomplete="new-password">
      </div>
      <p id="authError" class="auth-error" role="alert"></p>
      <button class="primary" id="forgotSubmitBtn" type="submit">Find account</button>
      <button type="button" class="secondary" id="cancelForgotBtn">Back to Sign in</button>
    `;
    $('#cancelForgotBtn').onclick = () => authForm('login');
    let questionFetched = false;
    $('#authForm').onsubmit = async (event) => {
      event.preventDefault();
      $('#authError').textContent = '';
      const usernameInput = $('#forgotUsername');
      const username = usernameInput.value.trim();
      if (!username) {
        $('#authError').textContent = 'Please enter your username';
        return;
      }
      if (!questionFetched) {
        try {
          const res = await api(`/auth/recovery-question?username=${encodeURIComponent(username)}`);
          $('#recoveryPrompt').textContent = `Security question: ${res.recovery_question}`;
          $('#recoveryStep').classList.remove('hidden');
          usernameInput.readOnly = true;
          $('#recoveryAnswer').required = true;
          $('#newPassword').required = true;
          $('#forgotSubmitBtn').textContent = 'Reset password';
          questionFetched = true;
          setTimeout(() => $('#recoveryAnswer').focus(), 50);
        } catch (error) {
          $('#authError').textContent = error.message || 'User not found';
        }
      } else {
        const answer = $('#recoveryAnswer').value.trim();
        const newPassword = $('#newPassword').value;
        if (!answer) {
          $('#authError').textContent = 'Please enter your recovery answer';
          return;
        }
        if (!newPassword || newPassword.length < 8) {
          $('#authError').textContent = 'New password must be at least 8 characters';
          return;
        }
        try {
          await api('/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({
              username: username,
              recovery_answer: answer,
              new_password: newPassword
            })
          });
          toast('Password reset successfully! Please sign in.');
          authForm('login');
        } catch (error) {
          $('#authError').textContent = error.message || 'Incorrect recovery answer';
        }
      }
    };
    return;
  }
}

const INTRO_THEMES = {
  female: {
    '8-18': {
      art: '/assets/intro/intro_8_18.png',
      avatar: '/assets/intro/avatar_8_18.png',
      theme: 'theme-intro-young'
    },
    '19-25': {
      art: '/assets/intro/intro_19_25.png',
      avatar: '/assets/intro/avatar_19_25.png',
      theme: 'theme-intro-mid'
    },
    '25+': {
      art: '/assets/intro/intro_25_plus.jpg',
      avatar: '/assets/intro/avatar_25_plus.jpg',
      theme: 'theme-intro-adult'
    }
  },
  male: {
    '8-18': {
      art: '/assets/intro/intro_male_8_18.jpg',
      avatar: '/assets/intro/avatar_male_8_18.png',
      theme: 'theme-intro-young'
    },
    '19-25': {
      art: '/assets/intro/intro_male_19_25.jpg',
      avatar: '/assets/intro/avatar_male_19_25.png',
      theme: 'theme-intro-mid'
    },
    '25+': {
      art: '/assets/intro/intro_male_25_plus.jpg',
      avatar: '/assets/intro/avatar_male_25_plus.jpg',
      theme: 'theme-intro-adult'
    }
  }
};

function renderIntroStep() {
  const introCard = $('#onboardingIntro');
  if (!introCard) return;
  introCard.classList.remove('hidden');
  $('#onboardingCard').classList.add('hidden');

  const backBtn = $('#introBackBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      showOnboarding('age');
    };
  }

  const signOutBtn = $('#introSignOutBtn');
  if (signOutBtn) {
    signOutBtn.onclick = () => {
      token = null;
      user = null;
      localStorage.removeItem('diary_token');
      $('#onboarding').classList.add('hidden');
      introCard.classList.add('hidden');
      $('#auth').classList.remove('hidden');
      authForm('login');
    };
  }

  const genderKey = user?.gender === 'male' ? 'male' : 'female';
  const ageKey = user?.age_range || '19-25';
  const genderThemes = INTRO_THEMES[genderKey] || INTRO_THEMES.female;
  const config = genderThemes[ageKey] || genderThemes['19-25'];

  introCard.classList.remove('theme-intro-young', 'theme-intro-mid', 'theme-intro-adult');
  introCard.classList.add(config.theme);

  const artImg = $('#introArtwork');
  if (artImg) artImg.src = config.art;

  let customAvatarFile = null;
  let customAvatarDataUrl = null;
  const photoInput = $('#introPhotoInput');
  const avatarImg = $('#introAvatarImg');
  const nameInput = $('#introNameInput');
  const continueBtn = $('#introContinueBtn');

  if (photoInput) photoInput.value = '';
  if (nameInput) {
    nameInput.value = user.display_name || '';
    setTimeout(() => nameInput.focus(), 100);
  }

  if (avatarImg) {
    if (user.avatar_url && !user.avatar_url.includes('/assets/intro/')) {
      avatarImg.src = getAvatarUrl(user.avatar_url);
      avatarImg.classList.remove('hidden');
    } else {
      avatarImg.src = '';
      avatarImg.classList.add('hidden');
    }
  }

  const cameraBadge = $('.intro-camera-badge');
  const avatarCircle = $('#introAvatarCircle');
  if (photoInput) {
    if (cameraBadge) cameraBadge.onclick = (e) => { if (e.target !== photoInput) photoInput.click(); };
    if (avatarCircle) avatarCircle.onclick = () => photoInput.click();
    photoInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      customAvatarFile = file;
      const reader = new FileReader();
      reader.onload = (evt) => {
        customAvatarDataUrl = evt.target.result;
        if (avatarImg) {
          avatarImg.src = customAvatarDataUrl;
          avatarImg.classList.remove('hidden');
        }
      };
      reader.readAsDataURL(file);
    };
  }

  const handleContinue = async () => {
    const rawName = nameInput ? nameInput.value.trim() : '';
    const name = rawName || user?.display_name || user?.username || 'Friend';
    if (continueBtn) {
      continueBtn.disabled = true;
      continueBtn.textContent = 'Saving...';
    }
    try {
      let avatarUrl = user?.avatar_url || null;
      if (customAvatarFile) {
        try {
          const formData = new FormData();
          formData.append('file', customAvatarFile);
          const uploadResult = await api('/auth/avatar', {
            method: 'POST',
            body: formData
          });
          if (uploadResult && uploadResult.avatar_url) {
            avatarUrl = uploadResult.avatar_url;
            user = { ...user, avatar_url: avatarUrl };
          }
        } catch (uploadErr) {
          console.warn('Avatar multipart upload failed, attempting base64 fallback:', uploadErr);
          if (customAvatarDataUrl) {
            avatarUrl = customAvatarDataUrl;
          }
        }
      }
      if ((!avatarUrl || avatarUrl.includes('/assets/intro/')) && config?.avatar) {
        avatarUrl = config.avatar;
      }
      const settingsPayload = {
        display_name: name,
        diary_title: `${name}’s Diary`,
        gender: user?.gender || 'female',
        age_range: user?.age_range || '19-25',
        ...(avatarUrl ? { avatar_url: avatarUrl } : {})
      };
      try {
        const updated = await api('/auth/settings', {
          method: 'PATCH',
          body: JSON.stringify(settingsPayload)
        });
        user = { ...user, ...updated };
      } catch (settingsErr) {
        console.error('Settings update failed:', settingsErr);
        user = { ...user, ...settingsPayload };
      }

      user.display_name = name;
      user.diary_title = user.diary_title || `${name}’s Diary`;
      user.gender = user.gender || 'female';
      user.age_range = user.age_range || '19-25';
      if (avatarUrl) user.avatar_url = avatarUrl;

      $('#onboarding').classList.add('hidden');
      if (introCard) introCard.classList.add('hidden');
      $('#app').classList.remove('hidden');
      boot(false, true);
    } catch (err) {
      console.error('Failed to save profile:', err);
      $('#onboarding').classList.add('hidden');
      if (introCard) introCard.classList.add('hidden');
      $('#app').classList.remove('hidden');
      boot(false, true);
    }
  };

  if (continueBtn) {
    continueBtn.disabled = false;
    continueBtn.textContent = 'Continue →';
    continueBtn.onclick = handleContinue;
  }
  if (nameInput) {
    nameInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleContinue();
      }
    };
  }
}

function showOnboarding(initialStep = 'gender') {
  let step = initialStep;
  const render = () => {
    $('#auth').classList.add('hidden');
    $('#app').classList.add('hidden');
    $('#onboarding').classList.remove('hidden');

    if (step === 'intro') {
      renderIntroStep();
      return;
    }
    $('#onboardingIntro').classList.add('hidden');
    $('#onboardingCard').classList.remove('hidden');
    const genderStep = step === 'gender';
    $('#onboardingEyebrow').textContent = genderStep ? 'ONE SMALL DETAIL' : 'ONE MORE DETAIL';
    $('#onboardingTitle').textContent = genderStep ? 'About you' : 'Your age group';
    $('#onboardingSubtitle').textContent = genderStep ? 'How would you like to identify?' : 'Which range fits you?';
    $('#genderChoices').classList.toggle('hidden', !genderStep);
    $('#ageChoices').classList.toggle('hidden', genderStep);
    $('#onboardingError').textContent = '';

    const backBtn = $('#onboardingBackBtn');
    if (backBtn) {
      backBtn.style.display = genderStep ? 'none' : 'inline-block';
      backBtn.onclick = () => {
        step = 'gender';
        render();
      };
    }
  };

  const signOutBtn = $('#onboardingSignOutBtn');
  if (signOutBtn) {
    signOutBtn.onclick = () => {
      token = null;
      user = null;
      localStorage.removeItem('diary_token');
      $('#onboarding').classList.add('hidden');
      $('#auth').classList.remove('hidden');
      authForm('login');
    };
  }

  render();
  $('#onboardingForm').onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const value = genderStepValue(step, data);
    if (!value) { $('#onboardingError').textContent = 'Please choose one option to continue.'; return; }
    try {
      const payload = step === 'gender' ? { gender: value } : { age_range: value };
      user = { ...user, ...await api('/auth/settings', { method: 'PATCH', body: JSON.stringify(payload) }) };
      if (step === 'gender') {
        step = 'age';
        event.target.reset();
        render();
      } else {
        step = 'intro';
        render();
      }
    } catch (error) { $('#onboardingError').textContent = error.message; }
  };
}

function genderStepValue(step, data) { return step === 'gender' ? data.gender : data.age_range; }

function boot(forceOnboarding = false, skipOnboardingCheck = false) {
  if (!user) return;
  if (!skipOnboardingCheck) {
    const needsOnboarding = !user.gender || !user.age_range;
    if (forceOnboarding || needsOnboarding) {
      showOnboarding('gender');
      return;
    }
  }
  $('#auth').classList.add('hidden');
  $('#onboarding').classList.add('hidden');
  $('#onboardingIntro').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const displayName = user.display_name || user.username || 'Friend';
  const diaryTitle = user.diary_title || `${displayName}’s Diary`;
  $('#brandTitle').textContent = diaryTitle;
  $('#diaryTitle').value = diaryTitle;
  if ($('#settingsDisplayName')) {
    $('#settingsDisplayName').value = user.display_name || user.username || '';
  }
  $('#userName').textContent = `${displayName} (@${user.username})`;

  applyUserAvatar(user.avatar_url);
  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  view('pages', true);
  loadPage();
  loadArchive();
  loadCategories();
}

async function loadPage() {
  try {
    const result = await api('/entries?page=1&page_size=100');
    const today = localDateKey(new Date());
    allTodayPages = result.items
      .filter((entry) => (entry.category_id ?? null) === activeCategoryId && (activeCategoryId ? true : localDateKey(entry.entry_date) === today))
      .sort((a, b) => new Date(parseDate(a.entry_date)) - new Date(parseDate(b.entry_date)));
    $('#entryCount').textContent = allTodayPages.length;
    renderHeatmap(result.items);

    if (current && allTodayPages.some((entry) => entry.id === current.id)) {
      current = allTodayPages.find((entry) => entry.id === current.id);
    } else if (allTodayPages.length > 0) {
      current = allTodayPages[allTodayPages.length - 1];
    } else {
      current = null;
    }

    if (activeCategoryId) {
      $('#viewTitle').textContent = `${activeCategoryName} page`;
    } else {
      $('#viewTitle').textContent = 'Today’s page';
    }
    fillPage();
  } catch (error) { toast(error.message); }
}

function fillPage() {
  const entry = current;
  if ($('#entryTitle')) $('#entryTitle').value = entry?.title || '';
  $('#entryText').innerHTML = entry?.blocks?.find((block) => block.type === 'text')?.content || '';
  if ($('#mood')) $('#mood').value = entry?.mood || '😊';
  if ($('#tags')) $('#tags').value = (entry?.tags || []).join(', ');
  if ($('#saveState')) $('#saveState').textContent = entry ? 'Saved' : 'New page';
  updatePageIndicator();
}

let measureEl = null;
function getMeasureElement() {
  if (!measureEl) {
    measureEl = document.createElement('div');
    measureEl.className = 'editor';
    measureEl.setAttribute('aria-hidden', 'true');
    measureEl.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;z-index:-1000;box-sizing:border-box;margin:0;padding:0;border:0;line-height:32px;font-size:1.15rem;white-space:pre-wrap;word-break:break-word;height:auto!important;min-height:0!important;max-height:none!important;background:none!important;';
    document.body.appendChild(measureEl);
  }
  const editor = $('#entryText');
  if (editor) {
    const computed = window.getComputedStyle(editor);
    measureEl.style.width = computed.width;
    measureEl.style.fontFamily = computed.fontFamily;
    measureEl.style.fontSize = computed.fontSize;
    measureEl.style.lineHeight = computed.lineHeight;
    measureEl.style.letterSpacing = computed.letterSpacing;
  }
  return measureEl;
}

function getPageLines() {
  const editor = $('#entryText');
  if (!editor) return 0;
  const rawText = (editor.innerText || '').replace(/\r/g, '');
  const hasMedia = !!editor.querySelector('img, video, audio');
  if (!rawText.trim() && !hasMedia) return 0;

  let mediaLines = 0;
  editor.querySelectorAll('img, video').forEach(() => { mediaLines += 8; });
  editor.querySelectorAll('audio').forEach(() => { mediaLines += 2; });

  const cleanText = rawText.replace(/\n$/, '');
  const textLines = cleanText ? cleanText.split('\n').length : 0;

  const m = getMeasureElement();
  m.innerHTML = editor.innerHTML;
  const contentHeight = m.offsetHeight || m.scrollHeight;
  const visualLines = Math.round(contentHeight / 32);

  return Math.max(textLines + mediaLines, visualLines);
}

function updatePageIndicator() {
  const indicator = $('#pageIndicator');
  if (!indicator) return;
  const lines = Math.min(16, getPageLines());
  const currentIndex = current ? allTodayPages.findIndex((e) => e.id === current.id) : allTodayPages.length;
  const pageNum = currentIndex >= 0 ? currentIndex + 1 : allTodayPages.length + 1;
  const total = Math.max(allTodayPages.length, pageNum, 1);
  indicator.textContent = `Page ${pageNum} of ${total} · ${lines}/16 lines`;
}

function placeCaretAtEnd(element) {
  if (!element) return;
  element.focus();
  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
}

function renderHeatmap(items) {
  const days = new Set(items.map((entry) => localDateKey(entry.entry_date)));
  $('#heatmap').innerHTML = Array.from({ length: 35 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - 34 + index);
    const iso = localDateKey(date);
    const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<div class="rhythm-day"><i data-rhythm-date="${iso}" class="${days.has(iso) ? 'on' : ''}" title="Open ${label}${days.has(iso) ? ' · page added' : ''}"><time>${label}</time></i></div>`;
  }).join('');
  $$('#heatmap [data-rhythm-date]').forEach((box) => box.onclick = () => openArchiveDate(box.dataset.rhythmDate));
}

async function openArchiveDate(date) {
  try {
    const result = await api('/entries?page=1&page_size=100');
    view('archive', true);
    renderArchiveDay(date, result.items.filter((entry) => localDateKey(entry.entry_date) === date));
  } catch (error) { toast(error.message); }
}

async function save() {
  if (current && (current.category_id ?? null) !== activeCategoryId) {
    current = null;
  }
  const mediaBlocks = (current?.blocks || []).filter((block) => block.type !== 'text').map((block, index) => ({ type: block.type, content: block.content, position: index + 1 }));
  const editor = $('#entryText');
  const hasText = !!(editor && (editor.innerText || '').trim());
  const hasMedia = mediaBlocks.length > 0;
  const hasTitle = !!($('#entryTitle') && $('#entryTitle').value.trim());

  if (!current && !hasText && !hasMedia && !hasTitle) {
    return;
  }

  const data = {
    entry_date: current?.entry_date || splitDate || new Date().toISOString(),
    title: $('#entryTitle')?.value || '',
    mood: $('#mood')?.value || '😊',
    tags: $('#tags')?.value ? $('#tags').value.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
    category_id: activeCategoryId,
    blocks: [{ type: 'text', content: $('#entryText').innerHTML, position: 0 }, ...mediaBlocks]
  };
  try {
    current = current ? await api(`/entries/${current.id}`, { method: 'PATCH', body: JSON.stringify(data) }) : await api('/entries', { method: 'POST', body: JSON.stringify(data) });
    if ($('#saveState')) $('#saveState').textContent = 'Saved just now';
    loadArchive();
  } catch (error) { toast(error.message); }
}

async function advanceToNextPage(overflow = '') {
  if (splittingPage) return;
  splittingPage = true;
  try {
    clearTimeout(saveTimer);
    await save();

    const result = await api('/entries?page=1&page_size=100');
    const today = localDateKey(new Date());
    allTodayPages = result.items
      .filter((e) => (e.category_id ?? null) === activeCategoryId && (activeCategoryId ? true : localDateKey(e.entry_date) === today))
      .sort((a, b) => new Date(parseDate(a.entry_date)) - new Date(parseDate(b.entry_date)));

    const currentIndex = current ? allTodayPages.findIndex((e) => e.id === current.id) : -1;

    if (currentIndex >= 0 && currentIndex < allTodayPages.length - 1) {
      current = allTodayPages[currentIndex + 1];
      fillPage();
      if (overflow) {
        const existing = $('#entryText').innerText.replace(/\r/g, '');
        $('#entryText').innerText = overflow + (existing ? '\n' + existing : '');
        await save();
      }
    } else {
      splitDate = new Date(Date.now() + 1000).toISOString();
      const newPageData = {
        entry_date: splitDate,
        title: '',
        mood: $('#mood')?.value || '😊',
        tags: [],
        category_id: activeCategoryId,
        blocks: [{ type: 'text', content: overflow ? overflow.replace(/\n/g, '<br>') : '', position: 0 }]
      };
      current = await api('/entries', { method: 'POST', body: JSON.stringify(newPageData) });
      splitDate = null;
      await loadPage();
    }

    toast(overflow ? '16 lines complete — Switched to next page ✦' : 'Switched to next page ✦');
    placeCaretAtEnd($('#entryText'));
  } catch (error) {
    toast(error.message);
  } finally {
    splittingPage = false;
    updatePageIndicator();
  }
}

function isCaretAtStart(element) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  try {
    const preRange = document.createRange();
    preRange.selectNodeContents(element);
    preRange.setEnd(range.startContainer, range.startOffset);
    const textBefore = preRange.toString().replace(/[\r\n\s\u00a0]/g, '');
    const hasMediaBefore = !!preRange.cloneContents().querySelector('img, video, audio');
    return textBefore.length === 0 && !hasMediaBefore;
  } catch {
    return false;
  }
}

async function handlePageOverflow() {
  if (splittingPage) return;
  const editor = $('#entryText');
  const lines = getPageLines();
  if (lines <= 16) return;

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
  let lastTextNode = null;
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue && walker.currentNode.nodeValue.trim()) {
      lastTextNode = walker.currentNode;
    }
  }

  if (!lastTextNode) return;

  const words = lastTextNode.nodeValue.split(/(\s+)/);
  const overflowWords = [];

  while (getPageLines() > 16 && words.length > 1) {
    const popped = words.pop();
    overflowWords.unshift(popped);
    lastTextNode.nodeValue = words.join('');
  }
  const overflow = overflowWords.join('').trim();

  if (overflow) {
    await advanceToNextPage(overflow);
  }
}

async function ensureEntry() {
  if (!current) await save();
  return current;
}

async function uploadMedia(file, kind, placement = 'cursor') {
  try {
    const entry = await ensureEntry();
    const form = new FormData();
    form.append('file', file);
    const result = await api(`/media/upload/${entry.id}?kind=${kind}`, { method: 'POST', body: form });
    const source = result.url;
    const media = kind === 'image' ? `<img src="${MEDIA_BASE}${source}" alt="Attached memory">` : kind === 'video' ? `<video controls src="${MEDIA_BASE}${source}"></video>` : `<audio controls src="${MEDIA_BASE}${source}"></audio>`;
    placement === 'end' ? insertMediaAtEnd(media) : insertMediaAtCaret(media);
    current.blocks = [...(current.blocks || []), { id: result.id, type: kind, content: source, position: (current.blocks || []).length }];
    schedule();
    toast(`${kind === 'audio' ? 'Voice note' : 'Photo'} added to this page`);
  } catch (error) { toast(error.message); }
}

function insertTextAtCaret(text) {
  insertMediaAtCaret(document.createTextNode(text).textContent);
}

function insertMediaAtCaret(html) {
  const editor = $('#entryText');
  const selection = window.getSelection();
  if (savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
    selection.removeAllRanges();
    selection.addRange(savedEditorRange);
  } else if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
    editor.insertAdjacentHTML('beforeend', `<div>${html}</div><div><br></div>`);
    placeCaretAtEnd(editor);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = range.createContextualFragment(`<div>${html}</div><div><br></div>`);
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) {
    range.selectNodeContents(last);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedEditorRange = range.cloneRange();
  }
}

function insertMediaAtEnd(html) {
  const editor = $('#entryText');
  editor.insertAdjacentHTML('beforeend', `<div>${html}</div><div><br></div>`);
  editor.scrollTop = editor.scrollHeight;
  placeCaretAtEnd(editor);
}

const rememberEditorSelection = () => {
  const editor = $('#entryText');
  const selection = window.getSelection();
  if (selection.rangeCount && editor.contains(selection.anchorNode)) savedEditorRange = selection.getRangeAt(0).cloneRange();
};
document.addEventListener('selectionchange', rememberEditorSelection);
$('#entryText').addEventListener('blur', rememberEditorSelection);
$('#entryText').addEventListener('keyup', rememberEditorSelection);
$('#entryText').addEventListener('mouseup', rememberEditorSelection);
$('#entryText').addEventListener('click', (e) => {
  if (e.target === $('#entryText')) {
    placeCaretAtEnd($('#entryText'));
  }
});

const handleMediaFile = (file) => {
  if (!file) return;
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : null;
  if (!kind) { toast('Please choose an image, video, or audio file'); return; }
  uploadMedia(file, kind);
};
$('#media').onchange = (event) => handleMediaFile(event.target.files[0]);
const editorDropTarget = $('#entryText');
['dragenter', 'dragover'].forEach((name) => editorDropTarget.addEventListener(name, (event) => { event.preventDefault(); editorDropTarget.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((name) => editorDropTarget.addEventListener(name, (event) => { event.preventDefault(); editorDropTarget.classList.remove('dragging'); }));
editorDropTarget.addEventListener('drop', (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : null;
  if (kind) uploadMedia(file, kind, 'end'); else toast('Please drop an image, video, or audio file');
});

let recorder;
let voiceChunks = [];
const stickers = [
  '😊', '🥰', '😍', '😌', '✨', '💛', '🌸', '🌿', '☕', '🎉',
  '🫶', '📚', '🌧️', '⭐', '🍀', '🌈', '🦋', '🌻', '🍓', '🎧',
  '💫', '📝', '🎈', '🧸', '🍰', '🌊', '🪴', '💌', '🕯️', '🔥',
  '🌙', '☀️', '⛅', '❄️', '⛄', '🏖️', '🏝️', '🏕️', '🎨', '🎬',
  '😀', '😃', '😄', '😁', '😆', '🥹', '😂', '🤣', '🥲', '😇',
  '🙂', '🙃', '😉', '😘', '😋', '😜', '🤪', '🤩', '🥳', '😎',
  '🤔', '🫣', '🤫', '🫡', '🤗', '🫠', '😴', '🤤', '😔', '🥺',
  '😢', '😭', '😮‍💨', '😤', '🤯', '😳', '🥵', '🥶', '😱', '🥱',
  '❤️', '🧡', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖', '💗',
  '💓', '💞', '💕', '💘', '💝', '❤️‍🔥', '💔', '❣️', '🕊️', '🐾',
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🦁',
  '🐮', '🐷', '🐸', '🐵', '🐥', '🦉', '🐝', '🐞', '🐢', '🐬',
  '🌹', '🌺', '🌷', '🌼', '🌾', '🍁', '🍂', '🍃', '🍄', '🌱',
  '🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍒', '🍑', '🍍', '🥑',
  '🍔', '🍟', '🍕', '🌮', '🍜', '🍣', '🍩', '🍪', '🍫', '🍦',
  '🧋', '🍵', '🥤', '🥛', '🍷', '🥂', '🍿', '🧁', '🍯', '🥐',
  '💡', '📖', '✏️', '✒️', '🎼', '🎵', '🎶', '🎸', '🎹', '🎮',
  '🕹️', '🎲', '🎯', '⚽', '🏀', '🚲', '🚗', '✈️', '🚀', '⛵',
  '🎁', '🎀', '🪄', '🔮', '🧿', '🔑', '⏰', '📸', '💻', '💎'
];
$('#emojiButton').textContent = '▧ Stickers';
$('#emojiButton').onclick = () => $('#emojiPicker').classList.toggle('hidden');
$('#emojiPicker').innerHTML = stickers.map((sticker) => `<button type="button">${sticker}</button>`).join('');
$('#emojiPicker').onclick = (event) => { if (event.target === event.currentTarget) return; insertTextAtCaret(event.target.textContent); $('#emojiPicker').classList.add('hidden'); schedule(); };
$('#recordVoice').onclick = async () => {
  const button = $('#recordVoice');
  if (recorder?.state === 'recording') { recorder.stop(); button.textContent = '● Voice'; return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast('Voice recording is not supported here'); return; }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  voiceChunks = []; recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (event) => voiceChunks.push(event.data);
  recorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); uploadMedia(new File([new Blob(voiceChunks, { type: 'audio/webm' })], 'voice-note.webm', { type: 'audio/webm' }), 'audio'); };
  recorder.start(); button.textContent = '■ Stop recording'; toast('Recording voice note…');
};

function schedule() {
  clearTimeout(saveTimer);
  $('#saveState').textContent = 'Saving…';
  saveTimer = setTimeout(save, 800);
}

async function loadArchive() {
  try {
    const query = ($('#search')?.value || '').trim();
    let items = [];
    if (query) {
      const result = await api(`/entries/search/query?q=${encodeURIComponent(query)}`);
      items = result.items || [];
    } else {
      const result = await api('/entries?page=1&page_size=100');
      items = result.items || [];
    }
    const days = new Map();
    items.forEach((entry) => { const key = localDateKey(entry.entry_date); if (!days.has(key)) days.set(key, []); days.get(key).push(entry); });
    $('#archiveList').innerHTML = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, entries]) => `<article class="archive-item archive-day" data-archive-date="${date}"><time>${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</time><strong>${entries.length} page${entries.length === 1 ? '' : 's'} on this day</strong><span class="archive-category">Open day</span></article>`).join('') || '<p class="muted">No pages found.</p>';
    $$('#archiveList .archive-day').forEach((item) => item.onclick = () => {
      const dayEntries = (days.get(item.dataset.archiveDate) || []).slice().sort((a, b) => new Date(parseDate(a.entry_date)) - new Date(parseDate(b.entry_date)));
      renderArchiveDay(item.dataset.archiveDate, dayEntries);
    });
  } catch (err) {
    console.error(err);
  }
}

function confirmDialog(title = 'Delete page?', message = 'Are you sure you want to delete this page? This action cannot be undone.', okText = 'Delete') {
  return new Promise((resolve) => {
    const modal = $('#confirmModal');
    if (!modal) {
      resolve(window.confirm(message));
      return;
    }
    const titleEl = $('#confirmTitle');
    const msgEl = $('#confirmMessage');
    const okBtn = $('#confirmOkBtn');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (okBtn) okBtn.textContent = okText;
    modal.classList.remove('hidden');

    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      modal.classList.add('hidden');
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
    };
    document.addEventListener('keydown', onKey);

    const cancelBtn = $('#confirmCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => finish(false);
    modal.onclick = (e) => {
      if (e.target === modal) finish(false);
    };
    if (okBtn) okBtn.onclick = () => finish(true);
  });
}

async function refreshArchiveDay(date) {
  try {
    const query = ($('#search')?.value || '').trim();
    let items = [];
    if (query) {
      const result = await api(`/entries/search/query?q=${encodeURIComponent(query)}`);
      items = result.items || [];
    } else {
      const result = await api('/entries?page=1&page_size=100');
      items = result.items || [];
    }
    const dayEntries = items
      .filter((entry) => localDateKey(entry.entry_date) === date)
      .sort((a, b) => new Date(parseDate(a.entry_date)) - new Date(parseDate(b.entry_date)));
    renderArchiveDay(date, dayEntries);
  } catch (err) {
    console.error(err);
    loadArchive();
  }
}

async function editEntry(entry) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    await save();
  }
  current = entry;
  splitDate = null;
  activeCategoryId = entry.category_id || null;
  activeCategoryName = entry.category_name || '';
  setCategoryMode(!!entry.category_id);
  view('pages');
  try {
    const result = await api('/entries?page=1&page_size=100');
    const today = localDateKey(new Date());
    const isToday = localDateKey(entry.entry_date) === today;
    allTodayPages = result.items
      .filter((e) => (e.category_id ?? null) === activeCategoryId && (activeCategoryId ? true : localDateKey(e.entry_date) === (isToday ? today : localDateKey(entry.entry_date))))
      .sort((a, b) => new Date(parseDate(a.entry_date)) - new Date(parseDate(b.entry_date)));
    $('#entryCount').textContent = allTodayPages.length;
  } catch {}
  if (entry.category_id) {
    if ($('#viewTitle')) $('#viewTitle').textContent = `${activeCategoryName} page`;
  } else {
    const dateStr = new Date(`${localDateKey(entry.entry_date)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = parseDate(entry.entry_date || entry.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if ($('#viewTitle')) $('#viewTitle').textContent = `Editing: ${dateStr} (${timeStr})`;
  }
  fillPage();
  placeCaretAtEnd($('#entryText'));
  toast('Editing page ✦');
}

function openPageReader(entry) {
  const modal = $('#pageReaderModal');
  if (!modal) return;
  const timeStr = parseDate(entry.entry_date || entry.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateFormatted = new Date(`${localDateKey(entry.entry_date)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  
  if ($('#readerEyebrow')) $('#readerEyebrow').textContent = entry.category_name ? `CHAPTER · ${entry.category_name.toUpperCase()}` : 'MY DIARY';
  if ($('#readerTitle')) $('#readerTitle').textContent = (entry.title && entry.title.trim().toLowerCase() !== 'untitled page') ? entry.title : timeStr;
  if ($('#readerDate')) $('#readerDate').textContent = `${dateFormatted} · ${timeStr}`;
  if ($('#readerMood')) $('#readerMood').textContent = entry.mood ? `${entry.mood}` : '';

  const renderBlocks = (blocks) => {
    if (!blocks || !blocks.length) return '<p class="muted" style="margin:0">No writing on this page.</p>';
    return blocks.map((b) => {
      if (b.type === 'text') return b.content || '';
      if (b.type === 'image') return `<img src="${MEDIA_BASE}${b.content}" alt="Memory">`;
      if (b.type === 'video') return `<video controls src="${MEDIA_BASE}${b.content}"></video>`;
      if (b.type === 'audio') return `<audio controls src="${MEDIA_BASE}${b.content}"></audio>`;
      return '';
    }).join('');
  };
  if ($('#readerContent')) $('#readerContent').innerHTML = renderBlocks(entry.blocks);

  const closeReader = () => {
    modal.classList.add('hidden');
    document.removeEventListener('keydown', onReaderKey);
  };

  const onReaderKey = (e) => {
    if (e.key === 'Escape') closeReader();
  };
  document.addEventListener('keydown', onReaderKey);

  if ($('#closeReaderBtn')) $('#closeReaderBtn').onclick = closeReader;
  if ($('#readerCloseBtn')) $('#readerCloseBtn').onclick = closeReader;
  modal.onclick = (e) => {
    if (e.target === modal) closeReader();
  };

  if ($('#readerEditBtn')) {
    $('#readerEditBtn').onclick = () => {
      closeReader();
      editEntry(entry);
    };
  }

  if ($('#readerDeleteBtn')) {
    $('#readerDeleteBtn').onclick = async () => {
      const confirmed = await confirmDialog('Delete this page?', 'Are you sure you want to delete this page? This action cannot be undone.', 'Delete');
      if (!confirmed) return;
      try {
        await api(`/entries/${entry.id}`, { method: 'DELETE' });
        toast('Page deleted');
        closeReader();
        if (current && current.id === entry.id) {
          current = null;
          await loadPage();
        }
        await refreshArchiveDay(localDateKey(entry.entry_date));
      } catch (err) {
        toast(err.message || 'Failed to delete page');
      }
    };
  }

  modal.classList.remove('hidden');
}

function renderArchiveDay(date, entries) {
  const regularPages = entries.filter((entry) => !entry.category_id);
  const categoryGroups = new Map();
  entries.filter((entry) => entry.category_id).forEach((entry) => { const key = entry.category_name || 'Category'; if (!categoryGroups.has(key)) categoryGroups.set(key, []); categoryGroups.get(key).push(entry); });
  const renderBlocks = (blocks) => {
    if (!blocks || !blocks.length) return '<span class="muted">No content added.</span>';
    return blocks.map((b) => {
      if (b.type === 'text') return b.content || '';
      if (b.type === 'image') return `<img src="${MEDIA_BASE}${b.content}" alt="Memory" style="max-width:260px;max-height:180px;border-radius:9px;display:block;margin:8px 0">`;
      if (b.type === 'video') return `<video controls src="${MEDIA_BASE}${b.content}" style="max-width:260px;max-height:180px;border-radius:9px;display:block;margin:8px 0"></video>`;
      if (b.type === 'audio') return `<audio controls src="${MEDIA_BASE}${b.content}" style="max-width:300px;display:block;margin:8px 0"></audio>`;
      return '';
    }).join('');
  };
  const formatPageHeading = (entry) => {
    const time = parseDate(entry.entry_date || entry.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (entry.title && entry.title.trim() && entry.title.trim().toLowerCase() !== 'untitled page') {
      return `${escapeHtml(entry.title.trim())} <span style="font-weight:normal;color:var(--muted);font-size:.88rem;margin-left:6px">(${time})</span>`;
    }
    return time;
  };
  const entryMarkup = (entry) => `<article class="archive-entry-detail" data-entry-id="${entry.id}"><div class="archive-entry-head"><strong>${formatPageHeading(entry)}</strong><span>${escapeHtml(entry.mood)}</span><div class="archive-entry-actions"><button class="archive-edit-btn" data-edit-entry="${entry.id}" type="button">✏ Edit</button><button class="archive-delete" data-delete-entry="${entry.id}" type="button">Delete</button></div></div><div class="archive-entry-content">${renderBlocks(entry.blocks)}</div></article>`;
  
  const bottomActions = entries.length ? `<div class="archive-bottom-actions"><button id="deleteAllDayPages" class="delete-all-btn" type="button">🗑 Delete all pages</button></div>` : '';
  
  $('#archiveList').innerHTML = `<button id="backToArchive" class="secondary archive-back">← Back to archive</button><p class="eyebrow">${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>${regularPages.length ? `<section class="archive-group"><h3>Pages</h3>${regularPages.map(entryMarkup).join('')}</section>` : ''}${[...categoryGroups.entries()].map(([name, group]) => `<section class="archive-group"><h3>${escapeHtml(name)}</h3>${group.map(entryMarkup).join('')}</section>`).join('') || '<p class="muted">Nothing written on this day.</p>'}${bottomActions}`;
  
  $('#backToArchive').onclick = loadArchive;

  $$('#archiveList .archive-entry-detail').forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('button')) return;
      const entryId = Number(card.dataset.entryId);
      const targetEntry = entries.find((en) => en.id === entryId);
      if (targetEntry) openPageReader(targetEntry);
    };
  });

  $$('#archiveList [data-edit-entry]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const entryId = Number(btn.dataset.editEntry);
      const targetEntry = entries.find((en) => en.id === entryId);
      if (targetEntry) editEntry(targetEntry);
    };
  });

  $$('#archiveList [data-delete-entry]').forEach((button) => {
    button.onclick = async (e) => {
      e.stopPropagation();
      const entryId = Number(button.dataset.deleteEntry);
      const confirmed = await confirmDialog('Delete this page?', 'Are you sure you want to delete this page? This action cannot be undone.', 'Delete');
      if (!confirmed) return;
      try {
        await api(`/entries/${entryId}`, { method: 'DELETE' });
        toast('Page deleted');
        if (current && current.id === entryId) {
          current = null;
          await loadPage();
        }
        await refreshArchiveDay(date);
      } catch (err) {
        toast(err.message || 'Failed to delete page');
      }
    };
  });

  const deleteAllBtn = $('#deleteAllDayPages');
  if (deleteAllBtn) {
    deleteAllBtn.onclick = async () => {
      const confirmed = await confirmDialog('Delete all pages?', `Are you sure you want to delete all ${entries.length} pages from this day? This action cannot be undone.`, 'Delete all');
      if (!confirmed) return;
      try {
        await Promise.all(entries.map((en) => api(`/entries/${en.id}`, { method: 'DELETE' })));
        toast('All pages deleted');
        if (current && entries.some((en) => en.id === current.id)) {
          current = null;
          await loadPage();
        }
        await refreshArchiveDay(date);
      } catch (err) {
        toast(err.message || 'Failed to delete all pages');
      }
    };
  }
}

async function loadCategories() {
  try {
    const list = await api('/categories');
    $('#categoryList').innerHTML = list.map((category) => `<div class="category-item" data-category-id="${category.id}" data-category-name="${category.name}" style="border-left:4px solid ${category.color || '#d87983'}"><span>${category.icon} ${category.name}</span><button data-delete="${category.id}" class="secondary">Delete</button></div>`).join('') || '<p class="muted">No categories yet.</p>';
    $$('#categoryList .category-item').forEach((item) => item.onclick = async (event) => {
      if (event.target.closest('[data-delete]')) return;
      if (saveTimer) {
        clearTimeout(saveTimer);
        await save();
      }
      activeCategoryId = Number(item.dataset.categoryId);
      activeCategoryName = item.dataset.categoryName;
      current = null;
      setCategoryMode(true);
      view('pages');
      await loadPage();
    });
    $$('#categoryList [data-delete]').forEach((button) => {
      button.onclick = async () => {
        const confirmed = await confirmDialog('Delete category?', 'Are you sure you want to delete this category?', 'Delete');
        if (!confirmed) return;
        try {
          await api(`/categories/${button.dataset.delete}`, { method: 'DELETE' });
          if (activeCategoryId === Number(button.dataset.delete)) {
            activeCategoryId = null;
            activeCategoryName = '';
            setCategoryMode(false);
            current = null;
          }
          toast('Category deleted');
          loadCategories();
        } catch (err) {
          toast(err.message || 'Failed to delete category');
        }
      };
    });
  } catch {}
}

function view(name, skipLoad = false) {
  $$('.view').forEach((element) => element.classList.add('hidden'));
  $(`#${name}View`).classList.remove('hidden');
  $$('.nav').forEach((element) => element.classList.toggle('active', element.dataset.view === name));
  $('#viewTitle').textContent = { pages: 'Today’s page', categories: 'Categories', archive: 'Archive', settings: 'Settings', faq: 'Frequently Asked Questions' }[name] || 'My Diary';
  if ($('#newEntry')) $('#newEntry').style.display = (name === 'pages') ? '' : 'none';
  if (!skipLoad && name === 'archive') loadArchive();
  if (!skipLoad && name === 'categories') loadCategories();
}

$('.paper-head').id = 'entryMeta';
$('.tag-row').id = 'entryTags';
const setCategoryMode = (enabled) => document.body.classList.toggle('category-mode', enabled);

$$('[data-auth]').forEach((button) => button.onclick = () => {
  $$('[data-auth]').forEach((element) => element.classList.remove('active'));
  button.classList.add('active');
  authForm(button.dataset.auth);
});
$$('.nav').forEach((button) => button.onclick = async () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    await save();
  }
  if (button.dataset.view === 'pages') {
    activeCategoryId = null;
    activeCategoryName = '';
    current = null;
    setCategoryMode(false);
    view('pages');
    await loadPage();
    return;
  }
  if (button.dataset.view) view(button.dataset.view);
});
$('#entryText').oninput = async () => {
  updatePageIndicator();
  schedule();
  if (splittingPage) return;
  const lines = getPageLines();
  if (lines > 16) {
    await handlePageOverflow();
  }
};

$('#entryText').addEventListener('keydown', async (event) => {
  if (event.key === 'Backspace') {
    const currentIndex = current ? allTodayPages.findIndex((e) => e.id === current.id) : -1;
    if (currentIndex > 0 && isCaretAtStart($('#entryText'))) {
      event.preventDefault();
      clearTimeout(saveTimer);

      const editor = $('#entryText');
      const rawText = (editor.innerText || '').replace(/[\r\n\s\u00a0]/g, '');
      const hasMedia = !!editor.querySelector('img, video, audio');
      const isPageEmpty = !rawText && !hasMedia;

      if (isPageEmpty && current) {
        try {
          await api(`/entries/${current.id}`, { method: 'DELETE' });
          allTodayPages.splice(currentIndex, 1);
        } catch {}
      } else {
        await save();
      }

      current = allTodayPages[currentIndex - 1];
      fillPage();
      placeCaretAtEnd($('#entryText'));
      toast(`Page ${currentIndex} of ${allTodayPages.length}`);
      return;
    }
  }

  if (event.key === 'Enter') {
    const lines = getPageLines();
    if (lines >= 16) {
      event.preventDefault();
      await advanceToNextPage('');
      return;
    }
  }
});

if ($('#entryTitle')) $('#entryTitle').oninput = schedule;
if ($('#tags')) $('#tags').oninput = schedule;
if ($('#mood')) $('#mood').onchange = schedule;

async function navigatePage(direction) {
  try {
    clearTimeout(saveTimer);
    const editor = $('#entryText');
    const hasContent = !!(editor && (editor.innerText || '').trim()) || !!editor?.querySelector('img, video, audio');
    const hasTitle = !!($('#entryTitle') && $('#entryTitle').value.trim());

    if (direction === 1 && !hasContent && !hasTitle) {
      toast('Please write something on this page first');
      $('#entryText')?.focus();
      return;
    }

    if (hasContent || hasTitle) {
      await save();
    }

    const result = await api('/entries?page=1&page_size=100');
    const today = localDateKey(new Date());
    allTodayPages = result.items
      .filter((entry) => (entry.category_id ?? null) === activeCategoryId && (activeCategoryId ? true : localDateKey(entry.entry_date) === today))
      .sort((a, b) => new Date(parseDate(a.entry_date)) - new Date(parseDate(b.entry_date)));

    let currentIndex = current ? allTodayPages.findIndex((entry) => entry.id === current.id) : -1;
    if (currentIndex === -1 && allTodayPages.length > 0) {
      currentIndex = allTodayPages.length - 1;
    }

    if (direction === -1) {
      if (allTodayPages.length === 0 || currentIndex <= 0) {
        toast('This is the first page');
        return;
      }
      current = allTodayPages[currentIndex - 1];
      fillPage();
      placeCaretAtEnd($('#entryText'));
      toast(`Page ${currentIndex} of ${allTodayPages.length}`);
    } else if (direction === 1) {
      if (currentIndex >= 0 && currentIndex < allTodayPages.length - 1) {
        current = allTodayPages[currentIndex + 1];
        fillPage();
        placeCaretAtEnd($('#entryText'));
        toast(`Page ${currentIndex + 2} of ${allTodayPages.length}`);
      } else {
        if (hasContent || hasTitle) {
          await advanceToNextPage('');
        } else {
          toast('Please write something on this page first');
          $('#entryText')?.focus();
        }
      }
    }
  } catch (error) { toast(error.message); }
}
if ($('#previousPage')) $('#previousPage').onclick = () => navigatePage(-1);
if ($('#nextPage')) $('#nextPage').onclick = () => navigatePage(1);
if ($('#saveEntry')) $('#saveEntry').onclick = save;
if ($('#newEntry')) $('#newEntry').onclick = async () => {
  const editor = $('#entryText');
  const hasContent = !!(editor && (editor.innerText || '').trim()) || !!editor?.querySelector('img, video, audio');
  const hasTitle = !!($('#entryTitle') && $('#entryTitle').value.trim());
  if (!hasContent && !hasTitle) {
    toast('Please write something on this page first');
    $('#entryText')?.focus();
    return;
  }
  clearTimeout(saveTimer);
  await save();
  await advanceToNextPage('');
};
$('#search').oninput = loadArchive;
const themes = ['day', 'night', 'cinematic', 'pink', 'classic'];
const applyTheme = (theme) => {
  theme = theme || 'day';
  document.body.classList.remove(...themes.map((name) => `theme-${name}`));
  if (theme !== 'day') {
    document.body.classList.add(`theme-${theme}`);
    document.body.style.removeProperty('background');
    document.body.style.removeProperty('--body-bg');
  } else {
    // Day theme — set default background explicitly
    document.body.style.background = 'radial-gradient(circle at 15% 0,#fff8f1 0,transparent 32%),linear-gradient(135deg,#f7eee8,#f5e1e4)';
    document.body.style.setProperty('--body-bg', 'radial-gradient(circle at 15% 0,#fff8f1 0,transparent 32%),linear-gradient(135deg,#f7eee8,#f5e1e4)');
  }
  localStorage.setItem('diary_theme', theme);
};
$$('.theme-choice').forEach((button) => button.onclick = () => { applyTheme(button.dataset.theme); toast(`${button.textContent.trim()} theme applied`); });
const fontOptions = [['Caveat', 'Handwritten'], ['Dancing Script', 'Flowing'], ['Kalam', 'Casual'], ['Patrick Hand', 'Friendly'], ['Shadows Into Light', 'Light'], ['Homemade Apple', 'Personal'], ['Playfair Display', 'Elegant'], ['Cormorant Garamond', 'Classic'], ['EB Garamond', 'Literary'], ['Lora', 'Readable'], ['Merriweather', 'Comfortable'], ['Nunito', 'Modern'], ['Quicksand', 'Clean']];
$('.settings-panel').insertAdjacentHTML('beforeend', `<hr><div><p class="eyebrow">Writing font</p><div class="font-choices">${fontOptions.map(([font, label]) => `<button type="button" class="font-choice" data-font="${font}" style="font-family:'${font}'">${label}<small>${font}</small></button>`).join('')}</div></div>`);
const applyFont = (font) => { document.documentElement.style.setProperty('--entry-font', `'${font}', Georgia, serif`); document.documentElement.style.setProperty('--heading-font', `'${font}', Georgia, serif`); localStorage.setItem('diary_font', font); $$('.font-choice').forEach((button) => button.classList.toggle('selected', button.dataset.font === font)); };
$$('.font-choice').forEach((button) => button.onclick = () => { applyFont(button.dataset.font); toast(`${button.dataset.font} font applied`); });
applyFont(localStorage.getItem('diary_font') || 'Lora');
$('#logout').onclick = () => { token = null; user = null; localStorage.removeItem('diary_token'); localStorage.setItem('diary_theme', 'day'); applyTheme('day'); location.reload(); };
$('#addCategory').onclick = () => { $('#categoryModal').classList.remove('hidden'); $('#categoryName').focus(); };
$('#closeCategory').onclick = () => $('#categoryModal').classList.add('hidden');
$$('#iconChoices button').forEach((button) => button.onclick = () => { $('#categoryIcon').value = button.textContent; $$('#iconChoices button').forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); });
let selectedCategoryColor = '#d87983';
$$('#colorChoices button[data-color]').forEach((button) => button.onclick = () => { selectedCategoryColor = button.dataset.color; $('#customCategoryColor').value = selectedCategoryColor; $$('#colorChoices button').forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); });
$('#customCategoryColor').oninput = (event) => { selectedCategoryColor = event.target.value; };
$('#categoryForm').onsubmit = async (event) => { event.preventDefault(); try { await api('/categories', { method: 'POST', body: JSON.stringify({ name: $('#categoryName').value, icon: $('#categoryIcon').value, color: selectedCategoryColor }) }); $('#categoryForm').reset(); $('#categoryIcon').value = '✦'; selectedCategoryColor = '#d87983'; $('#customCategoryColor').value = selectedCategoryColor; $('#categoryModal').classList.add('hidden'); loadCategories(); } catch (error) { toast(error.message); } };
$('#saveSettings').onclick = async () => {
  try {
    const payload = { diary_title: $('#diaryTitle').value.trim() };
    const dispName = $('#settingsDisplayName') ? $('#settingsDisplayName').value.trim() : null;
    if (dispName) {
      payload.display_name = dispName;
    }
    const result = await api('/auth/settings', { method: 'PATCH', body: JSON.stringify(payload) });
    user = { ...user, ...result };
    $('#brandTitle').textContent = user.diary_title;
    const displayName = user.display_name || user.username || 'Friend';
    $('#userName').textContent = `${displayName} (@${user.username})`;
    toast('Settings saved');
  } catch (error) { toast(error.message); }
};


const settingsPhotoInput = $('#settingsPhotoInput');
if (settingsPhotoInput) {
  settingsPhotoInput.onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadUserAvatar(file);
    settingsPhotoInput.value = '';
  };
};
$('#export').onclick = async () => {
  try {
    const data = await api('/backup/export');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    link.download = `diary_backup_${user?.username || 'user'}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast('JSON backup exported');
  } catch (error) { toast(error.message); }
};
const exportPdfBtn = $('#exportPdf');
if (exportPdfBtn) {
  exportPdfBtn.onclick = async () => {
    try {
      toast('Generating PDF...');
      const response = await fetch(`${API}/backup/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error('PDF export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `diary_${user?.username || 'user'}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      toast('PDF downloaded');
    } catch (error) { toast(error.message); }
  };
}
$('#import').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await api('/backup/import', { method: 'POST', body: form });
    toast(res.message || 'Backup imported');
    await loadPage();
    await loadCategories();
    await loadArchive();
  } catch (error) { toast(error.message); }
};
applyTheme(localStorage.getItem('diary_theme') || 'day');
authForm();
(async () => {
  if (token) {
    try {
      user = await api('/auth/me');
      const needsOnboarding = !user.gender || !user.age_range;
      if (!needsOnboarding) {
        boot(false, true);
      } else {
        showOnboarding('gender');
      }
    } catch {
      localStorage.removeItem('diary_token');
      token = null;
      user = null;
      $('#auth').classList.remove('hidden');
      $('#onboarding').classList.add('hidden');
      $('#app').classList.add('hidden');
    }
  }
})();
