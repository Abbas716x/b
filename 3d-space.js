/* ==================================================================
   XQD716 NEXUS 6.0 — Interactive 3D Cosmic Space Engine
   ================================================================== */

(function () {
    'use strict';

    const canvas = document.getElementById('space-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;

    // Visual Palette & Dynamic Tuning
    const COLORS = ['#00FFFF', '#C026D3', '#00FF88', '#FF0080', '#FFD700'];
    const IS_MOBILE = window.innerWidth < 768;
    const PARTICLE_COUNT = IS_MOBILE ? 35 : 75;
    const STAR_COUNT = IS_MOBILE ? 65 : 145;
    const CONNECTION_DIST = IS_MOBILE ? 110 : 165;

    let particles = [];
    let stars = [];
    let shockwaves = [];

    // Pointer & Perspective Coordinates
    const mouse = {
        x: -9999,
        y: -9999,
        active: false,
        radius: 160
    };

    const tilt = {
        targetX: 0,
        targetY: 0,
        currentX: 0,
        currentY: 0
    };

    // Responsive Canvas Resize
    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        initStars();
        initParticles();
    }

    // Initialize Deep Space Twinkling Stars
    function initStars() {
        stars = [];
        for (let i = 0; i < STAR_COUNT; i++) {
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                size: Math.random() * 1.6 + 0.4,
                alpha: Math.random() * 0.8 + 0.2,
                twinkleSpeed: Math.random() * 0.02 + 0.005,
                color: Math.random() > 0.35 ? '#ffffff' : (Math.random() > 0.5 ? '#00FFFF' : '#C026D3')
            });
        }
    }

    // Initialize Foreground Neon 3D Particles
    function initParticles() {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push(createParticle());
        }
    }

    function createParticle() {
        const depth = Math.random() * 0.8 + 0.4;
        return {
            x: Math.random() * width,
            y: Math.random() * height,
            z: depth,
            vx: (Math.random() - 0.5) * 0.45 * depth,
            vy: (Math.random() - 0.5) * 0.45 * depth,
            radius: (Math.random() * 2.2 + 1.2) * depth,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            pulse: Math.random() * Math.PI * 2,
            pulseSpeed: Math.random() * 0.03 + 0.015,
            mass: depth * 1.5
        };
    }

    // Spawn a Dynamic Shockwave on Click
    function triggerShockwave(x, y) {
        shockwaves.push({
            x: x,
            y: y,
            radius: 6,
            maxRadius: IS_MOBILE ? 140 : 220,
            alpha: 0.85,
            speed: 6.5,
            color: COLORS[Math.floor(Math.random() * COLORS.length)]
        });

        // Instant radial impulse on neighboring particles
        particles.forEach(p => {
            const dx = p.x - x;
            const dy = p.y - y;
            const dist = Math.hypot(dx, dy);
            if (dist < 200 && dist > 1) {
                const force = ((200 - dist) / 200) * 8.5;
                p.vx += (dx / dist) * force;
                p.vy += (dy / dist) * force;
            }
        });
    }

    // Main Simulation Loop
    let lastTime = 0;
    const FRAME_RATE_LIMIT = 1000 / 60;

    function render(currentTime) {
        requestAnimationFrame(render);

        const delta = currentTime - lastTime;
        if (delta < FRAME_RATE_LIMIT) return;
        lastTime = currentTime;

        ctx.clearRect(0, 0, width, height);

        // Smooth Parallax Interpolation
        tilt.currentX += (tilt.targetX - tilt.currentX) * 0.06;
        tilt.currentY += (tilt.targetY - tilt.currentY) * 0.06;

        // 1. Render Deep Stars
        stars.forEach(star => {
            star.alpha += Math.sin(currentTime * star.twinkleSpeed) * 0.012;
            const clampedAlpha = Math.max(0.15, Math.min(0.9, star.alpha));
            ctx.fillStyle = star.color;
            ctx.globalAlpha = clampedAlpha;
            ctx.beginPath();
            ctx.arc(
                star.x + tilt.currentX * 2,
                star.y + tilt.currentY * 2,
                star.size,
                0,
                Math.PI * 2
            );
            ctx.fill();
        });

        ctx.globalAlpha = 1.0;

        // 2. Constellation Web Lines
        for (let i = 0; i < particles.length; i++) {
            const p1 = particles[i];
            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const dist = Math.hypot(dx, dy);

                if (dist < CONNECTION_DIST) {
                    const alpha = (1 - dist / CONNECTION_DIST) * 0.35 * Math.min(p1.z, p2.z);
                    ctx.strokeStyle = `rgba(0, 255, 255, ${alpha})`;
                    ctx.lineWidth = 0.8 * Math.min(p1.z, p2.z);
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }

        // 3. Update & Draw Particles
        particles.forEach(p => {
            p.pulse += p.pulseSpeed;

            // Pointer Repulsion
            if (mouse.active) {
                const mdx = p.x - mouse.x;
                const mdy = p.y - mouse.y;
                const mdist = Math.hypot(mdx, mdy);

                if (mdist < mouse.radius && mdist > 0.1) {
                    const mforce = (mouse.radius - mdist) / mouse.radius;
                    p.vx += (mdx / mdist) * mforce * 0.65 * p.z;
                    p.vy += (mdy / mdist) * mforce * 0.65 * p.z;
                }
            }

            // Apply Velocity & 3D Perspective Drift
            p.x += p.vx + tilt.currentX * p.z * 0.4;
            p.y += p.vy + tilt.currentY * p.z * 0.4;

            // Gentle Damping
            p.vx *= 0.985;
            p.vy *= 0.985;

            // Maintain Base Drift
            if (Math.abs(p.vx) < 0.1) p.vx += (Math.random() - 0.5) * 0.05;
            if (Math.abs(p.vy) < 0.1) p.vy += (Math.random() - 0.5) * 0.05;

            // Screen Bounds Wrap
            if (p.x < 0) { p.x = 0; p.vx *= -1; }
            if (p.x > width) { p.x = width; p.vx *= -1; }
            if (p.y < 0) { p.y = 0; p.vy *= -1; }
            if (p.y > height) { p.y = height; p.vy *= -1; }

            const currentRadius = p.radius * (1 + Math.sin(p.pulse) * 0.2);

            // Draw Glow & Particle
            ctx.beginPath();
            ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 16 * p.z;
            ctx.globalAlpha = 0.85;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1.0;
        });

        // 4. Update & Draw Shockwaves
        for (let i = shockwaves.length - 1; i >= 0; i--) {
            const sw = shockwaves[i];
            sw.radius += sw.speed;
            sw.alpha -= 0.02;

            if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
                shockwaves.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
            ctx.strokeStyle = sw.color;
            ctx.globalAlpha = sw.alpha;
            ctx.lineWidth = 2.5;
            ctx.shadowColor = sw.color;
            ctx.shadowBlur = 20;
            ctx.stroke();
            ctx.restore();
        }
    }

    // Input Listeners
    window.addEventListener('resize', resize);

    window.addEventListener('mousemove', e => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;

        tilt.targetX = (e.clientX / width - 0.5) * 4;
        tilt.targetY = (e.clientY / height - 0.5) * 4;

        // Parallax offset for background glow orbs
        const orbs = document.querySelectorAll('.orb');
        orbs.forEach((orb, idx) => {
            const factor = (idx % 2 === 0 ? -1 : 1) * (10 + idx * 4);
            orb.style.transform = `translate(${tilt.targetX * factor}px, ${tilt.targetY * factor}px)`;
        });
    });

    window.addEventListener('mouseleave', () => {
        mouse.active = false;
        tilt.targetX = 0;
        tilt.targetY = 0;
    });

    window.addEventListener('click', e => {
        // Prevent canvas shockwaves if clicking within interactive UI elements
        if (e.target.closest('.modal-bd') || e.target.closest('button') || e.target.closest('.inp') || e.target.closest('.drawer')) {
            return;
        }
        triggerShockwave(e.clientX, e.clientY);
    });

    window.addEventListener('touchmove', e => {
        if (e.touches[0]) {
            mouse.x = e.touches[0].clientX;
            mouse.y = e.touches[0].clientY;
            mouse.active = true;

            tilt.targetX = (mouse.x / width - 0.5) * 4;
            tilt.targetY = (mouse.y / height - 0.5) * 4;
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        mouse.active = false;
        tilt.targetX = 0;
        tilt.targetY = 0;
    });

    // Boot Engine
    resize();
    requestAnimationFrame(render);
})();
