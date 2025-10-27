(() => {
  /* ========= UTIL ========= */
  const TAU=Math.PI*2, deg=r=>r*Math.PI/180;
  const now = () => performance.now()/1000;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const normAngle=a=>{a%=TAU; if(a>Math.PI)a-=TAU; if(a<-Math.PI)a+=TAU; return a;}
  const angleDiff=(a,b)=>normAngle(a-b);
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const delay = (ms)=>new Promise(r=>setTimeout(r,ms));

  /* ========= TOGGLES ========= */
  const IS_TESTING = true;   // PRODUCTION: set to false
  const AD_UNIT_ID = IS_TESTING
    ? 'ca-app-pub-3940256099942544/5224354917' // Google test rewarded
    : 'ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx'; // your real Rewarded ID
  const DEBUG_ADS   = true;

  /* ========= MINI DEBUG OVERLAY ========= */
  let _adDbgEl=null;
  function adDbgInit(){
    if(!DEBUG_ADS || _adDbgEl) return;
    _adDbgEl=document.createElement('div');
    _adDbgEl.style.cssText='position:fixed;bottom:8px;left:8px;z-index:99;font:12px/1.2 monospace;color:#bdf;background:#000a;padding:6px 8px;border:1px solid #245;border-radius:8px;pointer-events:none;opacity:.9';
    _adDbgEl.textContent='AD: init…';
    document.body.appendChild(_adDbgEl);
  }
  function adDbg(msg){
    if(!DEBUG_ADS) return;
    if(!_adDbgEl) adDbgInit();
    const t=new Date().toTimeString().split(' ')[0];
    _adDbgEl.textContent=`${t}  ${msg}`;
    console.log('[ADS]', msg);
  }
  adDbgInit();

  /* ========= CANVAS ========= */
  const canvas=document.getElementById('game');
  const ctx=canvas.getContext('2d');
  let DPR=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  let CX=0, CY=0, BASE_R=160, THICK=16*DPR;

  function setVHVar(){
    const h=(window.visualViewport&&window.visualViewport.height)?window.visualViewport.height:window.innerHeight;
    document.documentElement.style.setProperty('--vh', (h*0.01)+'px');
  }

function updateSlowBadgePos(){
  // kolik CSS pixelů pod kruhem má badge být (snadno laditelné)
  const SLOW_BADGE_GAP_CSSPX = 90; 

  // y = střed kruhu + poloměr + mezera; přepočet z DPR na CSS px
  const yPx = (CY + BASE_R) / DPR + SLOW_BADGE_GAP_CSSPX;
  document.documentElement.style.setProperty('--slow-badge-top', `${Math.round(yPx)}px`);
}


function resize(){
  setVHVar();
  const w = Math.floor(window.innerWidth * DPR);
  const h = Math.floor(window.innerHeight * DPR);
  canvas.width = w; canvas.height = h;
  canvas.style.width = '100vw';
  canvas.style.height = 'calc(var(--vh, 1dvh) * 100)';

  CX = w/2; 
  CY = h/2.2;
  BASE_R = Math.min(w,h)/4.2;
  THICK  = Math.max(10*DPR, Math.min(BASE_R*0.20, 22*DPR));

  const centerWrap = document.getElementById('centerText');
  if (centerWrap) centerWrap.style.top = (CY / DPR) + 'px';

  // >>> aktualizace pozice badge POD kruhem <<<
  updateSlowBadgePos();
}

window.addEventListener('resize', resize, { passive:true });
if (window.visualViewport){
  visualViewport.addEventListener('resize', resize, { passive:true });
}

(function applyStatusBarOffsets(){
  const isAndroid = window?.Capacitor?.getPlatform?.() === 'android';
  document.documentElement.style.setProperty('--statusbar', isAndroid ? '32px' : '0px');
  document.documentElement.style.setProperty('--navbar',    isAndroid ? '16px' : '0px');
})();


  /* ========= STATE ========= */
  let state='menu'; // 'menu' | 'play' | 'over'
  let tPrev=now();

  // ring
  let angle=-Math.PI/2;
  let omega=deg(160);
  const GAP_BASE = deg(110);
  let gap = GAP_BASE;
  const gapMin=deg(18);
  const TIME_RESET_EVERY = 15;   // seconds
  let nextGapResetAt = 0;
  let gameStartTime = 0;

  // score
  let score=0;
  let best=Number(localStorage.getItem('stg_best')||0);
  let canTap=true;

  const topRow=document.getElementById('topRow');
  const scoreVal=document.getElementById('scoreVal');
  const bestVal=document.getElementById('bestVal');
  const worldVal=document.getElementById('worldVal');
  const worldPill=document.getElementById('worldPill');
  const bigText=document.getElementById('bigText');
  const subText=document.getElementById('subText');
  const howto=document.getElementById('howto');

  const playBonusBtn=document.getElementById('playBonusBtn');
  const playNoBonusBtn=document.getElementById('playNoBonusBtn');
  const slowBadge=document.getElementById('slowBadge');

  bestVal.textContent  = String(best);
  worldVal.textContent = '—';

  // visuals
  let flash=0, resultText=null, shake=0, freezeT=0, pendingAngle=null;
  let gapFade = 0;
  let perfectStreak=0, goodStreak=0;
  let speedScale=1, jitterT=0;

  // player marker
  let playerAngle=-Math.PI/2;
  const minDeltaPlayer=deg(40);

  // UI guard
  let uiArmed=false;

  /* ========= AUDIO ========= */
  const AudioCtx=window.AudioContext||window.webkitAudioContext; let actx=null;
  function beep(type='ok'){
    try{
      if(!actx) actx=new AudioCtx();
      const o=actx.createOscillator(), g=actx.createGain(), t=actx.currentTime;
      let f=420; if(type==='perfect') f=840; else if(type==='good') f=620; else if(type==='fail') f=220;
      o.frequency.value=f; o.type='sine';
      g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.5,t+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t+(type==='fail'?0.25:0.12));
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t+(type==='fail'?0.26:0.14));
    }catch(e){}
  }
  function streakSound(){ try{ if(!actx) actx=new AudioCtx(); const t=actx.currentTime; const o=actx.createOscillator(), g=actx.createGain();
    o.type='triangle'; o.frequency.setValueAtTime(520,t); o.frequency.exponentialRampToValueAtTime(1040,t+0.10);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.7,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.28);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t+0.3);}catch(e){} }
  function streakSound2(){ try{ if(!actx) actx=new AudioCtx(); const t=actx.currentTime; const o=actx.createOscillator(), g=actx.createGain();
    o.type='sine'; o.frequency.setValueAtTime(480,t); o.frequency.exponentialRampToValueAtTime(720,t+0.08);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.7,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.22);
    o.connect(g); o.onended=()=>{}; g.connect(actx.destination); o.start(t); o.stop(t+0.24);}catch(e){} }

  /* ========= REWARDED / BADGE ========= */
  const AdMob = window?.Capacitor?.Plugins?.AdMob;

// střídání ob hru: 1. hra bez bonusu, 2. hra s bonusem, pak se to střídá
let offerBonusNext = false;


  let rewardGrantedPending = false; // set when onReward fires
  let pendingStartAfterReward = false; // start as soon as the ad closes if user tapped primary
  let slowAvailable = false;
  let slowActiveUntil = 0;
  let slowTimer = null;

  let admobInited = false;
  let listenersBound = false;

  async function ensureAdmob(){
    adDbg(window?.Capacitor?.Plugins?.AdMob ? 'AdMob plugin: OK' : 'AdMob plugin: MISSING');
    if(!AdMob?.initialize) return false;
    if(!admobInited){
      try{
        await AdMob.initialize({ initializeForTesting: IS_TESTING });
        admobInited = true;
        adDbg(`AdMob initialized (testing=${IS_TESTING})`);
      }catch(e){ adDbg('AdMob init error'); }
    }
    if(!listenersBound){
      AdMob.addListener('onRewardedVideoAdReward', () => {
  adDbg('event: onRewardedVideoAdReward');
  rewardGrantedPending = true;
});


      AdMob.addListener('onRewardedVideoAdDismissed', async () => {
        adDbg('event: onRewardedVideoAdDismissed');
        if (pendingStartAfterReward) {
          const granted = rewardGrantedPending;
          pendingStartAfterReward = false;
          startGame();
          if (granted) toast('Bonus ready for the next game.');
          else toast('Starting without bonus.');
        }
        Reward.onDismiss();
      });

      AdMob.addListener('onRewardedVideoAdFailedToLoad', () => {
        adDbg('event: onRewardedVideoAdFailedToLoad'); Reward.onLoadFailed();
      });
      AdMob.addListener('onRewardedVideoAdLoaded', () => {
        adDbg('event: onRewardedVideoAdLoaded'); Reward.onLoaded();
      });
      AdMob.addListener('onRewardedVideoAdFailedToShow', () => {
        adDbg('event: onRewardedVideoAdFailedToShow'); toast('Ad failed — starting without bonus.'); Reward.onLoadFailed();
        if (pendingStartAfterReward){ pendingStartAfterReward=false; startGame(); }
      });

      listenersBound = true;
    }
    return true;
  }

  const BACKOFF_MS = [400, 800, 1500, 2500, 4000, 6000, 8000, 12000];

  const Reward = {
    state: 'idle',             // 'idle' | 'loading' | 'loaded' | 'showing'
    loadingPromise: null,
    autoPlayQueued: false,
    backoffIdx: 0,
    prewarmRunning: false,
    lastLoadTs: 0,

    toIdle(){ this.state='idle'; this.loadingPromise=null; },

    toLoaded(){
      if (this.state !== 'showing') {
        adDbg('state → loaded'); this.state='loaded'; this.loadingPromise=null; this.backoffIdx=0;
      }
    },

    async load(force=false){
      if(!(await ensureAdmob())) { adDbg('ensureAdmob(): false'); return false; }
      if(this.state==='loaded') return true;
      if(this.state==='loading' && this.loadingPromise) return this.loadingPromise;

      const diff = Date.now() - this.lastLoadTs;
      if(!force && diff < 800) await delay(800 - diff);
      this.lastLoadTs = Date.now();

      adDbg('action: load'); this.state='loading';
      this.loadingPromise = AdMob.prepareRewardVideoAd({ adId: AD_UNIT_ID, isTesting: IS_TESTING })
        .then(()=>true).catch(()=>{ this.onLoadFailed(); return false; });
      return this.loadingPromise;
    },

    async show(){
      adDbg('action: show');
      if(!(await ensureAdmob())) { adDbg('ensureAdmob(): false'); return false; }

      if(this.state!=='loaded'){
        this.autoPlayQueued = true;
        await this.load(true);
        return false;
      }

      try{
        this.state='showing';
        await AdMob.showRewardVideoAd();
        adDbg('show: success');
        return true;
      }catch(err){
        this.toIdle();
        return false;
      }
    },

    onLoaded(){
      this.toLoaded();
      if(this.autoPlayQueued && this.state==='loaded'){
        this.autoPlayQueued=false;
        this.show();
      }
    },

    onLoadFailed(){
      adDbg('state → load failed');
      this.toIdle();
      this.backoffIdx = Math.min(this.backoffIdx+1, BACKOFF_MS.length-1);
      if (this.autoPlayQueued) {
        this.autoPlayQueued = false;
        toast('Ad unavailable — starting without bonus.');
        if (pendingStartAfterReward){ pendingStartAfterReward=false; startGame(); }
      }
    },

    onDismiss(){
      adDbg('state → dismissed, prewarm');
      this.autoPlayQueued = false; this.toIdle(); this.startPrewarm();
    },

    startPrewarm(){ if(this.prewarmRunning) return; this.prewarmRunning = true; prewarmTick(); },
    stopPrewarm(){ this.prewarmRunning=false; }
  };

  async function prewarmTick(){
    while(Reward.prewarmRunning){
      if(Reward.state==='loaded' || Reward.state==='showing'){ await delay(6000); continue; }
      await Reward.load(true);
      const wait = BACKOFF_MS[Reward.backoffIdx] + Math.floor(Math.random()*300);
      await delay(wait);
    }
  }

  /* ========= INPUTS ========= */
  function onPress(){
    if (state === 'menu'){ handleFirstTapStart(); return; }
    if (state !== 'play' || !canTap) return;

    const d=Math.abs(angleDiff(playerAngle, angle));
    const inside = d <= gap/2;

    if (inside){
      let grade='ok', points=1, color=getCss('--ok');
      if(d<=deg(2)){ grade='perfect'; points=3; color=getCss('--perfect'); }
      else if(d<=deg(8)){ grade='good'; points=2; color=getCss('--good'); }

      score += points; canTap=false; scoreVal.textContent = String(score);

      if(grade==='perfect'){ perfectStreak++; goodStreak=0; }
      else if(grade==='good'){ goodStreak++; perfectStreak=0; }
      else { perfectStreak=0; goodStreak=0; }

      let streakAwarded=false;
      if(perfectStreak===3){
        perfectStreak=0; score=score*3; scoreVal.textContent=String(score);
        if(navigator.vibrate) navigator.vibrate([25,35,25,35]); streakSound();
        resultText={txt:'SCORE ×3', color:getCss('--perfect'), timer:1.0}; streakAwarded=true;
      }else if(goodStreak===3){
        goodStreak=0; score=score*2; scoreVal.textContent=String(score);
        if(navigator.vibrate) navigator.vibrate([18,22,18]); streakSound2();
        resultText={txt:'SCORE ×2', color:getCss('--good'), timer:1.0}; streakAwarded=true;
      }

      flash=1.0; if(navigator.vibrate) navigator.vibrate(12); beep(grade);
      if(!streakAwarded){ resultText={txt:grade.toUpperCase(), color, timer:.9}; }

      freezeT=0.50;
      gap = Math.max(gap * 0.94, gapMin);
      omega = Math.min( omega * 1.07 * (1 + (Math.random() * 0.08 - 0.04)), deg(650) );
      pendingAngle=randomAngleApart(playerAngle, minDeltaPlayer);

    } else {
      gameOver();
    }
  }

  canvas.addEventListener('pointerdown', onPress, {passive:true});
  window.addEventListener('keydown', e=>{ if(e.repeat) return; if(e.code==='Space'||e.code==='Enter') onPress(); });

  /* Top-row: World → leaderboard (placeholder) */
  worldPill.addEventListener('click', () => {
    if (state !== 'over') return;
    toast('Leaderboard coming soon.');
  });

  /* Bottom CTAs */
function setDualCTA(){ 
  // zobraz bonus + no bonus
  playBonusBtn.style.display = 'block';
  playNoBonusBtn.style.display = 'block';

  // reset „No Bonus“ do sekundárního vzhledu
  playNoBonusBtn.textContent = 'Play Again – No Bonus';
  playNoBonusBtn.classList.remove('btn-primary','btn--primary');
  playNoBonusBtn.classList.add('btn-ghost','btn--secondary');
}

function setSingleCTA(){
  // schovej bonusový button a udělej z „No Bonus“ hlavní tlačítko uprostřed
  playBonusBtn.classList.remove('show','enabled');
  playBonusBtn.style.display = 'none';

  playNoBonusBtn.textContent = 'PLAY AGAIN';
  playNoBonusBtn.classList.remove('btn-ghost','btn--secondary');
  playNoBonusBtn.classList.add('btn-primary','btn--primary');
  playNoBonusBtn.style.visibility = 'visible';
}

playBonusBtn.addEventListener('click', async () => {
  if (!uiArmed || state!=='over') return;

  if (!navigator.onLine){
    toast('Offline — starting without bonus.');
    startGame();
    return;
  }

  // zkus reklamu, ale nenecháme hráče čekat
  pendingStartAfterReward = true;
  Reward.autoPlayQueued = true;

  const showed = await Reward.show();
  if (showed) return; // start proběhne po dismissu reklamy

  // reklama není připravená → krátká grace doba, pak hned start bez bonusu
  const GRACE_MS = 600;
  Reward.load(true); // přednačítání na pozadí
  setTimeout(() => {
    if (Reward.state !== 'showing' && state === 'over') {
      Reward.autoPlayQueued = false;
      pendingStartAfterReward = false;
      toast('Bonus will be ready next round.');
      startGame();
    }
  }, GRACE_MS);
});


  playNoBonusBtn.addEventListener('click', () => {
    if (!uiArmed || state!=='over') return;
    startGame();
  });

  /* ========= HOWTO / FLOW ========= */
  function alignIdleLikeThis(){ playerAngle=angle; }
  function handleFirstTapStart(){ if(howto) howto.classList.add('hide'); playMusic(); startGame(); }
  function showHomeTitle(){
    if(!bigText) return;
    bigText.innerHTML='<span class="title-stack"><span class="title-loading">LOADING</span><span class="title-rush">RUSH</span></span>';
    if(subText) subText.textContent='TAP ANYWHERE TO START';
  }

  function startGame(){
    fadeInMusic();
    state='play';

    // reset
    score=0; scoreVal.textContent='0';
    angle=-Math.PI/2; omega=deg(160); gap=GAP_BASE;
    gameStartTime = now();
    nextGapResetAt = gameStartTime + TIME_RESET_EVERY;

    resultText=null; flash=0; shake=0; speedScale=1; jitterT=0; freezeT=0; pendingAngle=null;
    playerAngle=-Math.PI/2; perfectStreak=0; goodStreak=0; canTap=true;

// UI
bigText.textContent='';
if (subText) subText.textContent='';

// jistota: úplně schovej (i kdyby zůstala třída z předchozí hry)
playBonusBtn.classList.remove('show','enabled');
playNoBonusBtn.classList.remove('show','enabled');
playBonusBtn.style.visibility = 'hidden';
playNoBonusBtn.style.visibility = 'hidden';
// návrat do defaultu pro další kolo
playNoBonusBtn.classList.remove('btn-primary','btn--primary');
playNoBonusBtn.classList.add('btn-ghost','btn--secondary');
playNoBonusBtn.textContent = 'Play Again – No Bonus';
playBonusBtn.style.display = 'block';


topRow.classList.remove('blink');


    // carry rewarded
    if (rewardGrantedPending){
      rewardGrantedPending = false;
      slowAvailable = true;
      slowActiveUntil = 0;
      slowBadge.classList.add('show');
      slowBadge.textContent = 'Activate Slow Motion 10 s';
    } else {
      slowAvailable = false;
      slowActiveUntil = 0;
      slowBadge.classList.remove('show');
      clearInterval(slowTimer); slowTimer=null;
    }
  }

function gameOver(){
  // --- HNED skryj a vypni Slow Motion badge ---
  slowAvailable = false;
  slowActiveUntil = 0;
  clearInterval(slowTimer); slowTimer = null;
  slowBadge.classList.remove('show');      // okamžitě zmizí
  // --------------------------------------------

  fadeOutMusic();

  // short red flash
  document.documentElement.style.setProperty('--neon','#ff6b6b');
  setTimeout(()=>document.documentElement.style.setProperty('--neon','#2af5d2'),250);

  state = 'over';
  if(navigator.vibrate) navigator.vibrate([20,40,35]);
  beep('fail'); 
  shake = 12;

  // BEST
  best = Math.max(best, score);
  localStorage.setItem('stg_best', best);
  bestVal.textContent = String(best);

  // show center GAME OVER text (jen krátce)
  if (bigText) bigText.textContent = 'GAME OVER';
  setTimeout(()=>{ if(state==='over') bigText.textContent=''; }, 2000);

  // blink top row 3×
  topRow.classList.add('blink');

// Rozhodni podle přepínače, co ukázat teď
const showBonusOffer = offerBonusNext;

if (showBonusOffer){
  setDualCTA();
  playBonusBtn.style.visibility = 'visible';
  playNoBonusBtn.style.visibility = 'visible';
  playBonusBtn.classList.add('show');
  playNoBonusBtn.classList.add('show');
} else {
  setSingleCTA();
  playNoBonusBtn.classList.add('show');
}

// Přepni pro další GAME OVER (střídání ob hru)
offerBonusNext = !offerBonusNext;

// odemkni kliky po malé prodlevě
uiArmed = false;
setTimeout(() => {
  uiArmed = true;
  if (showBonusOffer){
    playBonusBtn.classList.add('enabled');
    playNoBonusBtn.classList.add('enabled');
  } else {
    playNoBonusBtn.classList.add('enabled');
  }
}, 320);

// reklamy předehřívej na pozadí
Reward.startPrewarm();
}


  /* ========= SLOW BADGE ========= */
  function startSlowCountdown(){
    clearInterval(slowTimer);
    const tick = () => {
      const rem = Math.max(0, Math.ceil(slowActiveUntil - now()));
      if (rem > 0) slowBadge.textContent = `Activate Slow Motion ${rem} s`;
      else { slowBadge.classList.remove('show'); clearInterval(slowTimer); slowTimer=null; }
    };
    tick(); slowTimer = setInterval(tick, 200);
  }
  slowBadge.addEventListener('click', () => {
    if (state !== 'play' || !slowAvailable) return;
    slowAvailable   = false;
    slowActiveUntil = now() + 10;
    startSlowCountdown();
  });

  /* ========= RENDER ========= */
  function getCss(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function randomAngleApart(prev, minDelta){
    let a=prev, tries=0;
    do{ a=rnd(-Math.PI,Math.PI); tries++; if(tries>50) break; }
    while(Math.abs(angleDiff(a,prev))<minDelta);
    return a;
  }
  function drawTriangleAtAngle(a,rPath){
    const offset=THICK/2 + 4*DPR;
    const rx=CX+Math.cos(a)*(rPath+offset), ry=CY+Math.sin(a)*(rPath+offset);
    const base=THICK*0.9, height=THICK*1.15;
    ctx.save(); ctx.translate(rx,ry); ctx.rotate(a+Math.PI);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-height,-base/2); ctx.lineTo(-height,base/2); ctx.closePath();
    ctx.fillStyle=getCss('--neon'); ctx.shadowColor=getCss('--neon'); ctx.shadowBlur=10; ctx.fill(); ctx.shadowBlur=0; ctx.restore();
  }

  function render(dt){
    let sx=0, sy=0;
    if(shake>0){ sx=(Math.random()*2-1)*shake; sy=(Math.random()*2-1)*shake; shake*=0.86; if(shake<0.1) shake=0; }

    // gentle periodic widening
    if (state === 'play') {
      const tNow = now();
      if (tNow >= nextGapResetAt) {
        const targetGap = GAP_BASE;
        const diff = targetGap - gap;
        const expandSpeed = deg(120) * dt;
        const step = Math.sign(diff) * expandSpeed;
        if (Math.abs(diff) > 0.001) { gap += step; gapFade = 1.0; }
        else { gap = targetGap; nextGapResetAt = tNow + TIME_RESET_EVERY; }
      }
      if (gapFade > 0) { gapFade -= dt * 1.5; if (gapFade < 0) gapFade = 0; }
    }

    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save(); ctx.translate(sx,sy);

    if(state==='play'){
      if (freezeT>0){
        freezeT-=dt;
        if(freezeT<=0 && pendingAngle!==null){ playerAngle=pendingAngle; pendingAngle=null; canTap=true; }
      } else {
        const tNow = now();
        const easeIn = Math.min(1, (tNow - gameStartTime) / 0.3);
        let effectiveOmegaBase;
        if (slowActiveUntil > tNow) {
          const remaining = slowActiveUntil - tNow;
          const progress = clamp(1 - remaining / 10, 0, 1);
          effectiveOmegaBase = deg(160) + (omega - deg(160)) * progress;
        } else {
          effectiveOmegaBase = omega;
        }
        const effectiveOmega = effectiveOmegaBase * easeIn;
        angle += effectiveOmega * dt * speedScale;
      }
    }

    const R=BASE_R, thick=THICK;
    const centerA=angle, a1=centerA-gap/2, a2=centerA+gap/2;

    // base ring
    ctx.strokeStyle=getCss('--ring'); ctx.lineWidth=thick; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(CX,CY,R,0,TAU); ctx.stroke();

    // neon arc (no gap)
    const baseColor = getCss('--neon');
    ctx.strokeStyle = baseColor; ctx.shadowColor = baseColor;
    ctx.shadowBlur = 15 + 20 * gapFade; ctx.globalAlpha = 1 + 0.5 * gapFade;
    ctx.beginPath(); ctx.arc(CX, CY, R, a2, a1 + TAU); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;

    // player triangle
    drawTriangleAtAngle(playerAngle, R);

    // floating result text
    if(resultText){
      resultText.timer-=dt; const alpha=clamp(resultText.timer/0.7,0,1);
      ctx.globalAlpha=alpha; ctx.fillStyle=resultText.color;
      ctx.font=`800 ${Math.round(parseInt(getCss('--canvas-result')||'26',10)*DPR)}px "Oxanium", ui-sans-serif, system-ui, "Segoe UI", Roboto`;
      ctx.textAlign='center'; ctx.fillText(resultText.txt, CX, CY - R - 40*DPR);
      ctx.globalAlpha=1; if(resultText.timer<=0) resultText=null;
    }

    // hit flash
    if(flash>0){
      const rad=R + (1-flash)*R*0.4;
      ctx.strokeStyle=getCss('--neon'); ctx.globalAlpha=flash*0.65;
      ctx.lineWidth=thick*0.6*(flash); ctx.beginPath(); ctx.arc(CX,CY,rad,0,TAU); ctx.stroke();
      ctx.globalAlpha=1; flash-=dt*2.2; if(flash<0) flash=0;
    }

    ctx.restore();
  }

  /* ========= LOOP ========= */
  function tick(){ const t=now(); let dt=t-tPrev; tPrev=t; dt=Math.min(0.033,Math.max(0.001,dt)); render(dt); requestAnimationFrame(tick); }

  /* ========= INIT ========= */
  resize(); render(0); requestAnimationFrame(tick);
  showHomeTitle(); alignIdleLikeThis();

  // Prewarm ads silently on boot
  Reward.startPrewarm();

  window.addEventListener('pointerdown', ()=>{ if(!actx){ try{ actx=new AudioCtx(); }catch(e){} } }, {once:true, passive:true});

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      try{ if (actx && actx.state==='running') actx.suspend(); }catch(e){}
      if (typeof pauseMusic === 'function') pauseMusic();
    }
  }, { passive:true });

  window.addEventListener('pagehide', () => { if (typeof pauseMusic === 'function') pauseMusic(); }, { passive:true });

  /* ========= Toast ========= */
  function toast(msg){
    const el=document.createElement('div');
    el.className='toast'; el.textContent=msg; document.body.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('show'));
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(),200); }, 1700);
  }
})();

/* ========= BACKGROUND MUSIC ========= */
let bgMusic=null; let fadeInterval=null;
function playMusic(){ if(!bgMusic){ bgMusic=new Audio('music.mp3'); bgMusic.loop=true; bgMusic.volume=0.25; } if(bgMusic.paused) bgMusic.play().catch(()=>{}); }
function pauseMusic(){ if(!bgMusic) return; try{ clearInterval(fadeInterval); fadeInterval=null; bgMusic.pause(); }catch(e){} }
function fadeOutMusic(duration=1200){
  if(!bgMusic) return; const startVol=bgMusic.volume; const steps=28; const stepTime=duration/steps; let i=0;
  clearInterval(fadeInterval);
  fadeInterval=setInterval(()=>{ i++; bgMusic.volume=Math.max(0, startVol*(1 - i/steps));
    if(i>=steps){ clearInterval(fadeInterval); fadeInterval=null; bgMusic.pause(); bgMusic.currentTime=0; bgMusic.volume=startVol; }
  }, stepTime);
}
function fadeInMusic(duration=900){
  if(!bgMusic) return; bgMusic.volume=0; bgMusic.play().catch(()=>{});
  const targetVol=0.3; const steps=26; const stepTime=duration/steps; let i=0;
  clearInterval(fadeInterval);
  fadeInterval=setInterval(()=>{ i++; bgMusic.volume=Math.min(targetVol, (targetVol * i)/steps);
    if(i>=steps){ clearInterval(fadeInterval); fadeInterval=null; }
  }, stepTime);
}