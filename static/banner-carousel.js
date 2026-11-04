function bannerArt(banner) {
    const img = document.createElement('img');
    img.src = banner.image_url;
    img.alt = '';
    img.draggable = false;
    const focus = Number(banner.focus_x) + '% ' + Number(banner.focus_y) + '%';
    img.style.objectPosition = focus;
    img.style.transformOrigin = focus;
    img.style.transform = 'scale(' + Number(banner.zoom) / 100 + ')';
    return img;
}

function makeBannerCarousel(banners, settings, open) {
    const root = document.createElement('section');
    root.className = 'banner-carousel';
    root.setAttribute('aria-label', 'Баннеры');
    const viewport = document.createElement('div');
    viewport.className = 'banner-viewport';
    root.append(viewport);

    const slides = settings.enabled ? banners : banners.slice(0, 1);
    if (!slides.length) return root;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let current = 0, start, lastSwipe = -Infinity, timer;
    const items = slides.map(banner => {
        const slide = document.createElement(open && banner.action !== 'none' ? 'button' : 'div');
        slide.className = 'banner-slide';
        slide.setAttribute('aria-label', banner.title);
        slide.append(bannerArt(banner));
        if (slide.tagName === 'BUTTON') {
            slide.type = 'button';
            slide.onclick = () => {
                if (performance.now() - lastSwipe > 400) open(banner);
            };
        }
        viewport.append(slide);
        return slide;
    });
    const dots = document.createElement('div');
    dots.className = 'banner-dots';
    const controls = slides.length > 1 ? slides.map((banner, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', 'Баннер ' + (index + 1) + ': ' + banner.title);
        button.onclick = () => show(index, index < current);
        dots.append(button);
        return button;
    }) : [];
    if (controls.length) root.append(dots);

    // Optional position indicator. It is omitted from the DOM when disabled.
    let counter = null;
    if (settings.show_counter) {
        counter = document.createElement('div');
        counter.className = 'banner-position-counter';
        counter.setAttribute('role', 'status');
        counter.setAttribute('aria-label', 'Текущий баннер');
        root.append(counter);
    }

    function show(index, backwards = false) {
        if (index !== current) {
            items.forEach(slide => slide.classList.remove('banner-out', 'banner-backwards'));
            items[current].classList.remove('banner-active');
            items[current].classList.add('banner-out');
            items[index].classList.toggle('banner-backwards', backwards);
            items[current].classList.toggle('banner-backwards', backwards);
            current = index;
        }
        items.forEach((slide, position) => {
            const active = position === current;
            slide.classList.toggle('banner-active', active);
            slide.setAttribute('aria-hidden', String(!active));
            if (slide.tagName === 'BUTTON') slide.tabIndex = active ? 0 : -1;
            controls[position]?.setAttribute('aria-current', String(active));
        });
        if (counter) {
            counter.textContent = (current + 1) + ' из ' + slides.length;
        }
        clearTimeout(timer);
        if (slides.length > 1 && !reducedMotion.matches) timer = setTimeout(advance, settings.interval * 1000);
    }

    function advance() {
        if (!root.isConnected) return;
        if (document.hidden || root.matches(':hover, :focus-within')) show(current);
        else show((current + 1) % slides.length);
    }

    if (slides.length > 1) {
        viewport.addEventListener('pointerdown', event => {
            if (event.isPrimary) start = {x: event.clientX, y: event.clientY};
        });
        viewport.addEventListener('pointercancel', () => { start = null; });
        viewport.addEventListener('pointerup', event => {
            if (!start || !event.isPrimary) return;
            const dx = event.clientX - start.x, dy = event.clientY - start.y;
            start = null;
            if (Math.abs(dx) < 32 || Math.abs(dx) < Math.abs(dy)) return;
            lastSwipe = performance.now();
            show((current + (dx < 0 ? 1 : -1) + slides.length) % slides.length, dx > 0);
        });
    }
    show(0);
    return root;
}
