/* ============================================================
   PREMIUM CURSOR INTERACTION SYSTEM
   ------------------------------------------------------------
   - Custom animated cursor: precision dot + easing ring + radial glow
   - Faint particle trail that spawns while moving and fades out
   - Magnetic attraction: the ring is pulled toward hovered elements
   - Hero mouse-parallax for a subtle depth effect
   - GPU-accelerated (transform + opacity only) at 60fps via rAF
   - Accessibility:
       * disabled when the user prefers reduced motion
       * falls back to the native cursor on touch devices
       * all cursor layers are pointer-events:none (never blocks
         clicking or selecting text)
   ============================================================ */
(function () {
    'use strict';

    /* ------------------------------------------------------
       1. ACCESSIBILITY & DEVICE GUARDS
       Bail out early and keep the native cursor if the user
       prefers reduced motion or is on a touch device.
    ------------------------------------------------------ */
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    if (reducedMotion || coarsePointer) return;

    /* ------------------------------------------------------
       2. DOM REFS & ACTIVATION
       Grab the fixed cursor layers + trail canvas. If any are
       missing, bail silently. Otherwise reveal the custom
       cursor and hide the native one (via a class on <html>).
    ------------------------------------------------------ */
    const dot = document.querySelector('.cursor-dot');
    const ring = document.querySelector('.cursor-ring');
    const glow = document.querySelector('.cursor-glow');
    const canvas = document.getElementById('cursor-trail');
    if (!dot || !ring || !glow || !canvas) return;

    document.documentElement.classList.add('has-custom-cursor');
    document.body.classList.add('cursor-active');

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    /* ------------------------------------------------------
       3. CANVAS SIZING (device-pixel-ratio aware)
       Redraws on resize so particles stay crisp on HiDPI
       screens. Coordinates are kept in CSS pixels.
    ------------------------------------------------------ */
    let W, H, DPR;
    function resizeCanvas() {
        DPR = window.devicePixelRatio || 1;
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * DPR;
        canvas.height = H * DPR;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas, { passive: true });

    /* ------------------------------------------------------
       4. STATE
       - mouseX/mouseY: raw pointer position (the target)
       - dot/ring/glow positions: independently eased values
       - pullX/pullY: magnetic attraction point (element centre)
       - scale: animated ring size (grows on hover)
       - particles: array of active trail particles
    ------------------------------------------------------ */
    let mouseX = W / 2, mouseY = H / 2;
    let dotX = mouseX, dotY = mouseY;
    let ringX = mouseX, ringY = mouseY;
    let glowX = mouseX, glowY = mouseY;
    let pullX = mouseX, pullY = mouseY;
    let scale = 1, targetScale = 1;
    let hoverEl = null;
    let lastPX = mouseX, lastPY = mouseY;
    let trailClock = 0;
    const particles = [];
    let heroActive = true;

    const heroCard = document.querySelector('.hero-visual .profile-card');
    const heroParticles = document.getElementById('particles');

    /* Neon palette (RGB triplets) for trail particles */
    const PALETTE = ['129, 140, 248', '6, 182, 212', '236, 72, 153', '167, 139, 250'];

    /* Interactive elements that trigger grow + magnetic attraction */
    const HOVER_SELECTOR = [
        'a', 'button', '.btn', '.filter-btn', '.social-link', '.nav-link',
        '.portfolio-card', '.project-card', '.service-card', '.skill-tag',
        '.project-tags span', '.cta-btn', '.portfolio-image', '.testimonial-card',
        '.chart-card', '.kpi-card', '.workflow-step', '.arch-layer'
    ].join(',');

    /* ------------------------------------------------------
       5. POINTER HANDLERS (passive, read-only)
       mousemove only stores the target position — all easing
       happens in the animation loop. Hover state uses event
       delegation so we never attach per-element listeners.
    ------------------------------------------------------ */
    window.addEventListener('mousemove', function (e) {
        mouseX = e.clientX;
        mouseY = e.clientY;
    }, { passive: true });

    document.addEventListener('mouseover', function (e) {
        const el = e.target.closest ? e.target.closest(HOVER_SELECTOR) : null;
        if (el) {
            hoverEl = el;
            targetScale = 1.7;
            document.body.classList.add('cursor-hover');
        }
    });

    document.addEventListener('mouseout', function (e) {
        const el = e.target.closest ? e.target.closest(HOVER_SELECTOR) : null;
        if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) {
            hoverEl = null;
            targetScale = 1;
            document.body.classList.remove('cursor-hover');
        }
    });

    document.addEventListener('mouseleave', function () {
        hoverEl = null;
        targetScale = 1;
        document.body.classList.remove('cursor-hover');
    });

    /* Only run hero parallax while the hero is near the viewport */
    window.addEventListener('scroll', function () {
        heroActive = window.scrollY < window.innerHeight * 0.9;
    }, { passive: true });

    /* ------------------------------------------------------
       6. HELPERS
       lerp(): frame-rate independent linear interpolation
       spawnParticle(): adds a small drifting particle
    ------------------------------------------------------ */
    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function spawnParticle(x, y, vx, vy) {
        if (particles.length >= 140) particles.shift();
        particles.push({
            x: x,
            y: y,
            vx: vx * 0.4 + (Math.random() - 0.5) * 0.6,
            vy: vy * 0.4 + (Math.random() - 0.5) * 0.6,
            life: 1,
            decay: 0.025 + Math.random() * 0.02,
            size: 1.5 + Math.random() * 2.5,
            color: PALETTE[(Math.random() * PALETTE.length) | 0]
        });
    }

    /* ------------------------------------------------------
       7. PARTICLE TRAIL
       Clears the canvas each frame, advances each particle,
       fades it out via its alpha, and removes dead ones.
    ------------------------------------------------------ */
    function drawTrail() {
        ctx.clearRect(0, 0, W, H);
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            if (p.life <= 0) { particles.splice(i, 1); continue; }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + p.color + ',' + (0.4 * p.life).toFixed(3) + ')';
            ctx.fill();
        }
    }

    /* ------------------------------------------------------
       8. MAIN LOOP
       Runs every frame via requestAnimationFrame:
       1. Spawn trail particles only while the pointer moves
       2. Resolve the magnetic attraction point (element centre)
       3. Ease dot (fast), ring (medium, toward pull point),
          glow (slow) toward their targets
       4. Ease ring scale for the hover "grow" effect
       5. Write GPU-friendly transforms (translate + scale only)
       6. Apply the hero mouse-parallax
       7. Draw the particle trail
    ------------------------------------------------------ */
    function animate() {
        // Spawn a faint particle when the pointer is in motion
        const dx = mouseX - lastPX;
        const dy = mouseY - lastPY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 3) {
            trailClock++;
            if (trailClock % 2 === 0) spawnParticle(mouseX, mouseY, dx, dy);
            lastPX = mouseX;
            lastPY = mouseY;
        }

        // Magnetic attraction: pull the ring toward the element's centre
        if (hoverEl) {
            const r = hoverEl.getBoundingClientRect();
            if (r.width && r.height) {
                pullX = r.left + r.width / 2;
                pullY = r.top + r.height / 2;
            } else {
                pullX = mouseX;
                pullY = mouseY;
            }
        } else {
            pullX = mouseX;
            pullY = mouseY;
        }

        // Eased positions — dot is snappy, ring trails, glow floats
        dotX = lerp(dotX, mouseX, 0.5);
        dotY = lerp(dotY, mouseY, 0.5);
        ringX = lerp(ringX, pullX, 0.18);
        ringY = lerp(ringY, pullY, 0.18);
        glowX = lerp(glowX, mouseX, 0.08);
        glowY = lerp(glowY, mouseY, 0.08);

        // Ease ring scale (grows when hovering interactive elements)
        scale = lerp(scale, targetScale, 0.16);

        // Apply transforms — translate + scale only (GPU friendly)
        dot.style.transform = 'translate3d(' + dotX + 'px,' + dotY + 'px,0) translate(-50%,-50%)';
        ring.style.transform = 'translate3d(' + ringX + 'px,' + ringY + 'px,0) translate(-50%,-50%) scale(' + scale + ')';
        glow.style.transform = 'translate3d(' + glowX + 'px,' + glowY + 'px,0) translate(-50%,-50%)';

        // Hero mouse-parallax: card and particles shift in opposite
        // directions for a subtle depth effect.
        if (heroActive) {
            const px = mouseX / W - 0.5;
            const py = mouseY / H - 0.5;
            if (heroCard) {
                heroCard.style.transform = 'translate3d(' + (px * 12) + 'px,' + (py * 10) + 'px,0)';
            }
            if (heroParticles) {
                heroParticles.style.transform = 'translate3d(' + (px * -26) + 'px,' + (py * -22) + 'px,0)';
            }
        }

        drawTrail();
        requestAnimationFrame(animate);
    }

    animate();
})();
