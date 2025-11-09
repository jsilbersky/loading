(() => {
  /* ========= UTIL ========= */
  const TAU = Math.PI * 2;
  const deg = r => r * Math.PI / 180;
  const now = () => performance.now() / 1000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const normAngle = a => {
    a %= TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
  };
  const angleDiff = (a, b) => normAngle(a - b);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const delay = ms => new Promise(r => setTimeout(r, ms));

  /* ========= CONFIG ========= */
  const IS_TESTING = true;
  const AD_UNIT_ID = IS_TESTING
    ? 'ca-app-pub-3940256099942544/5224354917'
    : 'ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx';

  /* ========= SLOW MOTION ========= */
  const BASE_OMEGA = deg(160);
  const MAX_OMEGA = deg(650);
  
  function slowFactorFor(currOmega) {
    const o = clamp(currOmega, BASE_OMEGA, MAX_OMEGA);
    const t = (o - BASE_OMEGA) / (MAX_OMEGA - BASE_OMEGA);
    const fStart = 0.75, fEnd = 0.45;
    return fStart + (fEnd - fStart) * t;
  }
  
  function isSlowActive(t = now()) {
    return slowActiveUntil > t;
  }

  /* ========= CANVAS ========= */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let CX = 0, CY = 0, BASE_R = 160, THICK = 16 * DPR;

  function setVHVar() {
    const h = (window.visualViewport?.height) || window.innerHeight;
    document.documentElement.style.setProperty('--vh', (h * 0.01) + 'px');
  }

  function resize() {
    setVHVar();
    const w = Math.floor(window.innerWidth * DPR);
    const h = Math.floor(window.innerHeight * DPR);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = '100vw';
    canvas.style.height = 'calc(var(--vh, 1dvh) * 100)';

    CX = w / 2;
    CY = h / 2.2;
    BASE_R = Math.min(w, h) / 4.2;
    THICK = Math.max(10 * DPR, Math.min(BASE_R * 0.20, 22 * DPR));

    const centerWrap = document.getElementById('centerText');
    if (centerWrap) centerWrap.style.top = (CY / DPR) + 'px';
  }

  window.addEventListener('resize', resize, { passive: true });
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', resize, { passive: true });
  }

  /* ========= STATE ========= */
  let state = 'menu';
  let tPrev = now();

  // Ring
  let angle = -Math.PI / 2;
  let omega = deg(160);
  const GAP_BASE = deg(110);
  let gap = GAP_BASE;
  const gapMin = deg(18);
  const TIME_RESET_EVERY = 15;
  let nextGapResetAt = 0;
  let gameStartTime = 0;

  // Score
  let score = 0;
  let best = Number(localStorage.getItem('lr_best') || 0);
  let canTap = true;
  let scoreFlashT = 0;

  // DOM refs
  const topRow = document.getElementById('topRow');
  const scoreVal = document.getElementById('scoreVal');
  const bestVal = document.getElementById('bestVal');
  const bigText = document.getElementById('bigText');
  const subText = document.getElementById('subText');
  const howto = document.getElementById('howto');
  const logoEl = document.getElementById('logo');
  const slowBadge = document.getElementById('slowBadge');

  // Modal refs
  const endModal = document.getElementById('endModal');
  const modalScore = document.getElementById('modalScore');
  const modalBest = document.getElementById('modalBest');
  const newBestChip = document.getElementById('newBestChip');
  const modalPrimary = document.getElementById('modalPrimary');
  const modalPrimarySub = document.getElementById('modalPrimarySub');
  const modalSecondary = document.getElementById('modalSecondary');
  const modalShare = document.getElementById('modalShare');

  // Visuals
  let flash = 0, resultText = null, shake = 0, freezeT = 0, pendingAngle = null;
  let gapFade = 0;
  let perfectStreak = 0, goodStreak = 0;
  let speedScale = 1;

  // Player
  let playerAngle = -Math.PI / 2;
  const minDeltaPlayer = deg(40);

  // Slow motion
  let slowAvailable = false;
  let slowActiveUntil = 0;
  let slowTimer = null;

  // Ad system
  let rewardGrantedPending = false;
  let pendingStartAfterReward = false;
  let admobInited = false;
  let listenersBound = false;

  bestVal.textContent = String(best);

  /* ========= AUDIO ========= */
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let actx = null;

  function beep(type = 'ok') {
    try {
      if (!actx) actx = new AudioCtx();
      const o = actx.createOscillator();
      const g = actx.createGain();
      const t = actx.currentTime;
      
      let f = 420;
      if (type === 'perfect') f = 840;
      else if (type === 'good') f = 620;
      else if (type === 'fail') f = 220;
      
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (type === 'fail' ? 0.25 : 0.12));
      o.connect(g);
      g.connect(actx.destination);
      o.start(t);
      o.stop(t + (type === 'fail' ? 0.26 : 0.14));
    } catch (e) {}
  }

  function streakSound() {
    try {
      if (!actx) actx = new AudioCtx();
      const t = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      
      o.type = 'triangle';
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(1040, t + 0.10);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.7, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g);
      g.connect(actx.destination);
      o.start(t);
      o.stop(t + 0.3);
    } catch (e) {}
  }

  function streakSound2() {
    try {
      if (!actx) actx = new AudioCtx();
      const t = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      
      o.type = 'sine';
      o.frequency.setValueAtTime(480, t);
      o.frequency.exponentialRampToValueAtTime(720, t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.7, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g);
      g.connect(actx.destination);
      o.start(t);
      o.stop(t + 0.24);
    } catch (e) {}
  }

  /* ========= ADMOB ========= */
  async function ensureAdmob() {
    const AdMob = window?.Capacitor?.Plugins?.AdMob;
    if (!AdMob?.initialize) return false;

    if (!admobInited) {
      try {
        await AdMob.initialize({ initializeForTesting: IS_TESTING });
        admobInited = true;
      } catch (e) {
        return false;
      }
    }

    if (!listenersBound) {
      AdMob.addListener('onRewardedVideoAdReward', () => {
        rewardGrantedPending = true;
      });
      
      AdMob.addListener('onRewardedVideoAdDismissed', async () => {
        if (pendingStartAfterReward) {
          const granted = rewardGrantedPending;
          pendingStartAfterReward = false;
          startGame();
          if (!granted) toast('Starting without bonus.');
        }
        Reward.onDismiss();
      });
      
      AdMob.addListener('onRewardedVideoAdFailedToLoad', () => {
        Reward.onLoadFailed();
      });
      
      AdMob.addListener('onRewardedVideoAdLoaded', () => {
        Reward.onLoaded();
      });
      
      AdMob.addListener('onRewardedVideoAdFailedToShow', () => {
        toast('Ad failed — starting without bonus.');
        Reward.onLoadFailed();
        if (pendingStartAfterReward) {
          pendingStartAfterReward = false;
          startGame();
        }
      });
      
      listenersBound = true;
    }

    return true;
  }

  const BACKOFF_MS = [400, 800, 1500, 2500, 4000, 6000, 8000, 12000];

  const Reward = {
    state: 'idle',
    loadingPromise: null,
    autoPlayQueued: false,
    backoffIdx: 0,
    prewarmRunning: false,
    lastLoadTs: 0,

    toIdle() {
      this.state = 'idle';
      this.loadingPromise = null;
    },
    
    toLoaded() {
      if (this.state !== 'showing') {
        this.state = 'loaded';
        this.loadingPromise = null;
        this.backoffIdx = 0;
      }
    },

    async load(force = false) {
      if (!(await ensureAdmob())) return false;
      if (this.state === 'loaded') return true;
      if (this.state === 'loading' && this.loadingPromise) return this.loadingPromise;
      
      const diff = Date.now() - this.lastLoadTs;
      if (!force && diff < 800) await delay(800 - diff);
      
      this.lastLoadTs = Date.now();
      this.state = 'loading';
      this.loadingPromise = window.Capacitor.Plugins.AdMob
        .prepareRewardVideoAd({ adId: AD_UNIT_ID, isTesting: IS_TESTING })
        .then(() => true)
        .catch(() => {
          this.onLoadFailed();
          return false;
        });
      
      return this.loadingPromise;
    },

    async show() {
      if (!(await ensureAdmob())) return false;
      if (this.state !== 'loaded') {
        this.autoPlayQueued = true;
        await this.load(true);
        return false;
      }
      
      try {
        this.state = 'showing';
        await window.Capacitor.Plugins.AdMob.showRewardVideoAd();
        return true;
      } catch (err) {
        this.toIdle();
        return false;
      }
    },

    onLoaded() {
      this.toLoaded();
      if (this.autoPlayQueued && this.state === 'loaded') {
        this.autoPlayQueued = false;
        this.show();
      }
    },
    
    onLoadFailed() {
      this.toIdle();
      this.backoffIdx = Math.min(this.backoffIdx + 1, BACKOFF_MS.length - 1);
      if (this.autoPlayQueued) {
        this.autoPlayQueued = false;
        toast('Ad unavailable — starting without bonus.');
        if (pendingStartAfterReward) {
          pendingStartAfterReward = false;
          startGame();
        }
      }
    },
    
    onDismiss() {
      this.autoPlayQueued = false;
      this.toIdle();
      this.startPrewarm();
    },

    startPrewarm() {
      if (this.prewarmRunning) return;
      this.prewarmRunning = true;
      prewarmTick();
    },
    
    stopPrewarm() {
      this.prewarmRunning = false;
    }
  };

  async function prewarmTick() {
    while (Reward.prewarmRunning) {
      if (Reward.state === 'loaded' || Reward.state === 'showing') {
        await delay(6000);
        continue;
      }
      await Reward.load(true);
      const wait = BACKOFF_MS[Reward.backoffIdx] + Math.floor(Math.random() * 300);
      await delay(wait);
    }
  }

  /* ========= GAME LOGIC ========= */
  function onPress() {
    if (state === 'menu') {
      handleFirstTapStart();
      return;
    }
    
    if (state !== 'play' || !canTap) return;

    const d = Math.abs(angleDiff(playerAngle, angle));
    const inside = d <= gap / 2;

    if (inside) {
      let grade = 'ok', points = 1, color = '#8fd4ff';
      
      if (d <= deg(2)) {
        grade = 'perfect';
        points = 3;
        color = '#fff7a1';
      } else if (d <= deg(8)) {
        grade = 'good';
        points = 2;
        color = '#73ffa9';
      }

      score += points;
      canTap = false;
      scoreVal.textContent = String(score);
      scoreVal.classList.add('flash');
      setTimeout(() => scoreVal.classList.remove('flash'), 400);

      if (grade === 'perfect') {
        perfectStreak++;
        goodStreak = 0;
      } else if (grade === 'good') {
        goodStreak++;
        perfectStreak = 0;
      } else {
        perfectStreak = 0;
        goodStreak = 0;
      }

      let streakAwarded = false;
      
      if (perfectStreak === 3) {
        perfectStreak = 0;
        score = score * 3;
        scoreVal.textContent = String(score);
        if (navigator.vibrate) navigator.vibrate([25, 35, 25, 35]);
        streakSound();
        resultText = { txt: 'SCORE ×3', color: '#fff7a1', timer: 1.0 };
        streakAwarded = true;
      } else if (goodStreak === 3) {
        goodStreak = 0;
        score = score * 2;
        scoreVal.textContent = String(score);
        if (navigator.vibrate) navigator.vibrate([18, 22, 18]);
        streakSound2();
        resultText = { txt: 'SCORE ×2', color: '#73ffa9', timer: 1.0 };
        streakAwarded = true;
      }

      flash = 1.0;
      if (navigator.vibrate) navigator.vibrate(12);
      beep(grade);
      
      const label = grade === 'perfect' ? 'PERFECT' : grade === 'good' ? 'GOOD' : 'OK';
      if (!streakAwarded) {
        resultText = { txt: `${label}  +${points}`, color, timer: 0.9 };
      }

      freezeT = 0.50;
      gap = Math.max(gap * 0.94, gapMin);
      
      if (!isSlowActive()) {
        omega = Math.min(omega * 1.07 * (1 + (Math.random() * 0.08 - 0.04)), MAX_OMEGA);
      }
      
      pendingAngle = randomAngleApart(playerAngle, minDeltaPlayer);
    } else {
      gameOver();
    }
  }

  canvas.addEventListener('pointerdown', onPress, { passive: true });
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'Enter') onPress();
  });

  function handleFirstTapStart() {
    if (howto) howto.classList.add('hide');
    playMusic();
    startGame();
  }

  function showHomeTitle() {
    if (!bigText) return;
    if (logoEl) logoEl.style.display = 'block';
    bigText.innerHTML = `
      <span class="title-stack">
        <span class="title-loading">LOADING</span>
        <span class="title-rush">RUSH</span>
      </span>
    `;
    if (subText) subText.textContent = 'Tap anywhere to start';
  }

  function startGame() {
    fadeInMusic();
    closeEndModal();
    
    state = 'play';
    score = 0;
    scoreVal.textContent = '0';
    angle = -Math.PI / 2;
    omega = deg(160);
    gap = GAP_BASE;
    gameStartTime = now();
    nextGapResetAt = gameStartTime + TIME_RESET_EVERY;

    resultText = null;
    flash = 0;
    shake = 0;
    speedScale = 1;
    freezeT = 0;
    pendingAngle = null;
    playerAngle = -Math.PI / 2;
    perfectStreak = 0;
    goodStreak = 0;
    canTap = true;
    
    document.body.classList.add('hud-hidden');

    if (logoEl) logoEl.style.display = 'none';
    bigText.textContent = '';
    if (subText) subText.textContent = '';

    topRow.classList.remove('blink');

    // Carry rewarded bonus
    if (rewardGrantedPending) {
      rewardGrantedPending = false;
      slowAvailable = true;
      slowActiveUntil = 0;
      slowBadge.classList.add('show');
      slowBadge.textContent = 'Activate Slow Motion';
    } else {
      slowAvailable = false;
      slowActiveUntil = 0;
      slowBadge.classList.remove('show');
      clearInterval(slowTimer);
      slowTimer = null;
    }
  }

  function gameOver() {
    slowAvailable = false;
    slowActiveUntil = 0;
    clearInterval(slowTimer);
    slowTimer = null;
    slowBadge.classList.remove('show');
    document.body.classList.remove('hud-hidden');

    fadeOutMusic();

    // Red flash
    document.documentElement.style.setProperty('--neon', '#ff6b6b');
    setTimeout(() => document.documentElement.style.setProperty('--neon', '#2af5d2'), 250);

    state = 'over';
    if (navigator.vibrate) navigator.vibrate([20, 40, 35]);
    beep('fail');
    shake = 12;

    // Update best
    best = Math.max(best, score);
    localStorage.setItem('lr_best', best);
    bestVal.textContent = String(best);

    // Show GAME OVER
    if (bigText) bigText.textContent = 'GAME OVER';
    setTimeout(() => {
      if (state === 'over') bigText.textContent = '';
    }, 2000);

    topRow.classList.add('blink');

    openEndModal();
    Reward.startPrewarm();
  }

  /* ========= SLOW MOTION BADGE ========= */
  function startSlowCountdown() {
    clearInterval(slowTimer);
    const tick = () => {
      const rem = Math.max(0, Math.ceil(slowActiveUntil - now()));
      if (rem > 0) {
        slowBadge.textContent = `SLOW MOTION: ${rem}s`;
      } else {
        slowBadge.classList.remove('show');
        clearInterval(slowTimer);
        slowTimer = null;
      }
    };
    tick();
    slowTimer = setInterval(tick, 200);
  }

  slowBadge.addEventListener('click', () => {
    if (state !== 'play' || !slowAvailable) return;
    
    slowAvailable = false;
    slowActiveUntil = now() + 10;
    
    const f = slowFactorFor(omega);
    const slowedOmega = Math.max(BASE_OMEGA, omega * f);
    omega = slowedOmega;
    
    slowBadge.textContent = 'SLOW MOTION: 10s';
    startSlowCountdown();
  });

  /* ========= MODAL ========= */
  function openEndModal() {
    modalScore.textContent = String(score);
    modalBest.textContent = String(best);
    newBestChip.hidden = !(score === best);

    endModal.classList.add('open');
    endModal.setAttribute('aria-hidden', 'false');
    
    setTimeout(() => modalPrimary.focus?.(), 50);
  }

  function closeEndModal() {
    endModal.classList.remove('open');
    endModal.setAttribute('aria-hidden', 'true');
  }

  modalPrimary.onclick = async () => {
    if (state !== 'over') return;
    
    if (!navigator.onLine) {
      toast('Offline — starting without bonus.');
      startGame();
      return;
    }
    
    pendingStartAfterReward = true;
    Reward.autoPlayQueued = true;
    const showed = await Reward.show();
    
    if (showed) return;
    
    const GRACE_MS = 600;
    Reward.load(true);
    setTimeout(() => {
      if (Reward.state !== 'showing' && state === 'over') {
        Reward.autoPlayQueued = false;
        pendingStartAfterReward = false;
        toast('Bonus will be ready next round.');
        startGame();
      }
    }, GRACE_MS);
  };

  modalSecondary.onclick = () => {
    if (state !== 'over') return;
    startGame();
  };

modalShare.onclick = async () => {
  await shareScoreNative();
};


/* ========= NATIVE SHARE (Capacitor) ========= */

// 1) Pomocné funkce
function dataUrlToBase64(dataUrl) {
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function fitFontPxForWidth(ctx, text, maxWidth, startPx = 240, minPx = 110) {
  let size = startPx;
  do {
    ctx.font = `800 ${size}px Oxanium`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  } while (size >= minPx);
  return size;
}

// 2) Vykreslení šablony + skóre + „SEC/T:“ do #shareCanvas
async function drawShareToCanvas(score) {
  const shareCanvas = document.getElementById('shareCanvas');
  const sctx = shareCanvas.getContext('2d');

  // a) Počkej na font (pokud je k dispozici)
  try { await (document.fonts?.ready || Promise.resolve()); } catch (_) {}

  // b) Načti šablonu
  const tpl = await loadImage('loading_rush_score.png');

  // c) Vyčisti a vykresli pozadí šablonou 1080×1920
  sctx.clearRect(0, 0, 1080, 1920);
  sctx.drawImage(tpl, 0, 0, 1080, 1920);

  // d) Skóre – střed x=540, baseline y=1120, max šířka 800 px
  const text = String(score);
  const maxWidth = 800;
  const fontPx = fitFontPxForWidth(sctx, text, maxWidth);
  const grad = sctx.createLinearGradient(0, 950, 0, 1100);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#2af5d2');

  sctx.textAlign = 'center';
  sctx.textBaseline = 'alphabetic';
  sctx.fillStyle = grad;
  sctx.shadowColor = 'rgba(42, 245, 210, 0.6)';
  sctx.shadowBlur = 40;
  sctx.font = `800 ${fontPx}px Oxanium`;
  sctx.fillText(text, 540, 1120);
  sctx.shadowBlur = 0;

  // e) Anti-cheat štítky (SEC + T:)
  const timestamp = new Date().toISOString(); // čitelná ISO značka
  const securityHash = btoa(String(score + Date.now())).substring(0, 12);

  sctx.font = '24px Oxanium';
  sctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  sctx.textAlign = 'left';
  sctx.fillText(`SEC:${securityHash}`, 60, 1860);
  sctx.textAlign = 'right';
  sctx.fillText(`T:${timestamp}`, 1020, 1860);
}

// 3) Uložení PNG do CACHE a nativní sdílení
async function shareScoreNative() {
  try {
    // Pluginy
    const Share = window?.Capacitor?.Plugins?.Share;
    const Filesystem = window?.Capacitor?.Plugins?.Filesystem;

    if (!Share || !Filesystem) {
      toast('Native share not available');
      return;
    }

    // A) vykresli šablonu + číslo
    await drawShareToCanvas(score);

    // B) získej base64 PNG
    const shareCanvas = document.getElementById('shareCanvas');
    const dataUrl = shareCanvas.toDataURL('image/png', 0.95);
    const base64 = dataUrlToBase64(dataUrl);

    // C) ulož do CACHE a získaj file:// URI
    const fileName = `lr_${Date.now()}.png`;
    const writeRes = await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: 'CACHE'
    });
    const fileUri = writeRes?.uri;
    if (!fileUri) {
      toast('Saving image failed');
      return;
    }

    // D) nativní share sheet (posíláme files i url – pro kompatibilitu)
    await Share.share({
      title: 'Loading Rush – My Score',
      text: `I scored ${score} in Loading Rush!`,
      files: [fileUri],
      url: fileUri,
      dialogTitle: 'Share your score'
    });

    // (volitelné) můžeš soubor smazat po sdílení:
  await Filesystem.deleteFile({ path: fileName, directory: 'CACHE' });

  } catch (err) {
    console.error(err);
    toast('Share failed');
  }
}


  /* ========= RENDER ========= */
  function getCss(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function randomAngleApart(prev, minDelta) {
    let a = prev, tries = 0;
    do {
      a = rnd(-Math.PI, Math.PI);
      tries++;
      if (tries > 50) break;
    } while (Math.abs(angleDiff(a, prev)) < minDelta);
    return a;
  }

  function drawTriangleAtAngle(a, rPath) {
    const offset = THICK / 2 + 4 * DPR;
    const rx = CX + Math.cos(a) * (rPath + offset);
    const ry = CY + Math.sin(a) * (rPath + offset);
    const base = THICK * 0.9;
    const height = THICK * 1.15;
    
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(a + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-height, -base / 2);
    ctx.lineTo(-height, base / 2);
    ctx.closePath();
    ctx.fillStyle = getCss('--neon');
    ctx.shadowColor = getCss('--neon');
    ctx.shadowBlur = 15;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function render(dt) {
    let sx = 0, sy = 0;
    if (shake > 0) {
      sx = (Math.random() * 2 - 1) * shake;
      sy = (Math.random() * 2 - 1) * shake;
      shake *= 0.86;
      if (shake < 0.1) shake = 0;
    }

    if (state === 'play') {
      const tNow = now();
      if (tNow >= nextGapResetAt) {
        const targetGap = GAP_BASE;
        const diff = targetGap - gap;
        const expandSpeed = deg(120) * dt;
        const step = Math.sign(diff) * expandSpeed;
        if (Math.abs(diff) > 0.001) {
          gap += step;
          gapFade = 1.0;
        } else {
          gap = targetGap;
          nextGapResetAt = tNow + TIME_RESET_EVERY;
        }
      }
      if (gapFade > 0) {
        gapFade -= dt * 1.5;
        if (gapFade < 0) gapFade = 0;
      }
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(sx, sy);

    if (state === 'play') {
      if (freezeT > 0) {
        freezeT -= dt;
        if (freezeT <= 0 && pendingAngle !== null) {
          playerAngle = pendingAngle;
          pendingAngle = null;
          canTap = true;
        }
      } else {
        const tNow = now();
        const easeIn = Math.min(1, (tNow - gameStartTime) / 0.3);
        const effectiveOmega = omega * easeIn;
        angle += effectiveOmega * dt * speedScale;
      }
    }

    const R = BASE_R;
    const thick = THICK;
    const centerA = angle;
    const a1 = centerA - gap / 2;
    const a2 = centerA + gap / 2;

    // Base ring with subtle gradient
    const ringGrad = ctx.createLinearGradient(CX - R, CY - R, CX + R, CY + R);
    ringGrad.addColorStop(0, 'rgba(42, 58, 64, 0.4)');
    ringGrad.addColorStop(1, 'rgba(31, 42, 46, 0.6)');
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = thick;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, TAU);
    ctx.stroke();

    // Neon arc (glowing)
    const neonColor = getCss('--neon');
    ctx.strokeStyle = neonColor;
    ctx.shadowColor = neonColor;
    ctx.shadowBlur = 15 + 25 * gapFade;
    ctx.globalAlpha = 1 + 0.5 * gapFade;
    ctx.beginPath();
    ctx.arc(CX, CY, R, a2, a1 + TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Player triangle
    drawTriangleAtAngle(playerAngle, R);

    // Floating result text
    if (resultText) {
      resultText.timer -= dt;
      const alpha = clamp(resultText.timer / 0.7, 0, 1);
      const yOffset = (1 - alpha) * 30;
      
      ctx.globalAlpha = alpha;
      ctx.fillStyle = resultText.color;
      ctx.font = `800 ${Math.round(28 * DPR)}px Oxanium`;
      ctx.textAlign = 'center';
      ctx.shadowColor = resultText.color;
      ctx.shadowBlur = 20;
      ctx.fillText(resultText.txt, CX, CY - R - (50 + yOffset) * DPR);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      
      if (resultText.timer <= 0) resultText = null;
    }

    // Hit flash
    if (flash > 0) {
      const rad = R + (1 - flash) * R * 0.4;
      ctx.strokeStyle = getCss('--neon');
      ctx.globalAlpha = flash * 0.7;
      ctx.lineWidth = thick * 0.7 * flash;
      ctx.shadowColor = getCss('--neon');
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.arc(CX, CY, rad, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      flash -= dt * 2.2;
      if (flash < 0) flash = 0;
    }

    ctx.restore();
  }

  /* ========= LOOP ========= */
  function tick() {
    const t = now();
    let dt = t - tPrev;
    tPrev = t;
    dt = Math.min(0.033, Math.max(0.001, dt));
    render(dt);
    requestAnimationFrame(tick);
  }

  /* ========= MUSIC ========= */
  let bgMusic = null;
  let fadeInterval = null;

  function playMusic() {
    if (!bgMusic) {
      bgMusic = new Audio('music.mp3');
      bgMusic.loop = true;
      bgMusic.volume = 0.25;
    }
    if (bgMusic.paused) bgMusic.play().catch(() => {});
  }

  function pauseMusic() {
    if (!bgMusic) return;
    try {
      clearInterval(fadeInterval);
      fadeInterval = null;
      bgMusic.pause();
    } catch (e) {}
  }

  function fadeOutMusic(duration = 1200) {
    if (!bgMusic) return;
    const startVol = bgMusic.volume;
    const steps = 28;
    const stepTime = duration / steps;
    let i = 0;
    
    clearInterval(fadeInterval);
    fadeInterval = setInterval(() => {
      i++;
      bgMusic.volume = Math.max(0, startVol * (1 - i / steps));
      if (i >= steps) {
        clearInterval(fadeInterval);
        fadeInterval = null;
        bgMusic.pause();
        bgMusic.currentTime = 0;
        bgMusic.volume = startVol;
      }
    }, stepTime);
  }

  function fadeInMusic(duration = 900) {
    if (!bgMusic) return;
    bgMusic.volume = 0;
    bgMusic.play().catch(() => {});
    
    const targetVol = 0.3;
    const steps = 26;
    const stepTime = duration / steps;
    let i = 0;
    
    clearInterval(fadeInterval);
    fadeInterval = setInterval(() => {
      i++;
      bgMusic.volume = Math.min(targetVol, (targetVol * i) / steps);
      if (i >= steps) {
        clearInterval(fadeInterval);
        fadeInterval = null;
      }
    }, stepTime);
  }

  /* ========= TOAST ========= */
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    
    requestAnimationFrame(() => el.classList.add('show'));
    
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2500);
  }

  /* ========= INIT ========= */
  resize();
  render(0);
  requestAnimationFrame(tick);
  showHomeTitle();

  // Start prewarming ads on boot
  Reward.startPrewarm();

  // Audio context unlock
  window.addEventListener('pointerdown', () => {
    if (!actx) {
      try {
        actx = new AudioCtx();
      } catch (e) {}
    }
  }, { once: true, passive: true });

  // Pause audio when hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      try {
        if (actx && actx.state === 'running') actx.suspend();
      } catch (e) {}
      pauseMusic();
    }
  }, { passive: true });

  window.addEventListener('pagehide', () => {
    pauseMusic();
  }, { passive: true });

  // Close modal on overlay click
  endModal.addEventListener('click', (e) => {
    if (e.target.dataset.close === 'modal') {
      // Don't allow closing modal in 'over' state without playing
    }
  });
})();
