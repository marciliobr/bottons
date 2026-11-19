(function () {
  const SIZES = {
    "32": {
      diameter: 32,
      cut: 44,
      places: [
        [6, 6], [83, 6], [160, 6],
        [44.5, 30.1], [121.5, 30.1],
        [6, 54.2], [83, 54.2], [160, 54.2],
        [44.5, 78.3], [121.5, 78.3],
        [6, 102.4], [83, 102.4], [160, 102.4],
        [44.5, 126.5], [121.5, 126.5],
        [6, 150.6], [83, 150.6], [160, 150.6],
        [44.5, 174.7], [121.5, 174.7],
        [6, 198.8], [83, 198.8], [160, 198.8],
        [44.5, 222.9], [121.5, 222.9],
        [6, 247], [83, 247], [160, 247]
      ]
    },
    "44": {
      diameter: 44,
      cut: 54,
      places: [
        [6, 6], [102, 6],
        [54, 34.875], [150, 34.875],
        [6, 63.75], [102, 63.75],
        [54, 92.625], [150, 92.625],
        [6, 121.5], [102, 121.5],
        [54, 150.375], [150, 150.375],
        [6, 179.25], [102, 179.25],
        [54, 208.125], [150, 208.125],
        [6, 237], [102, 237]
      ]
    },
    "58": {
      diameter: 58,
      cut: 70,
      places: [
        [70, 6],
        [6, 49],
        [134, 49],
        [70, 92],
        [6, 135],
        [134, 135],
        [70, 178],
        [6, 221],
        [134, 221]
      ]
    }
  };

  const minScale = 0.25;
  const fitScale = 1;
  const maxScale = 4;
  const sheet = document.getElementById("sheet");
  const countLabel = document.getElementById("count");
  const sizeMark = document.getElementById("size-mark");
  const inspector = document.getElementById("inspector");
  const inspectorHint = document.getElementById("inspector-hint");
  const adjustButton = document.getElementById("adjust");
  const zoomInput = document.getElementById("zoom");
  const rotationInput = document.getElementById("rotation");
  const brightnessInput = document.getElementById("brightness");
  const saturationInput = document.getElementById("saturation");
  const themeButton = document.getElementById("theme");
  const minBrightness = 0.4;
  const maxBrightness = 1.8;
  const minSaturation = 0;
  const maxSaturation = 2;
  const viewMin = 1;
  const viewMax = 3;
  const pageWidth = 210;
  const pageHeight = 297;
  const pageMargin = 6;
  const memory = {};
  let currentKey = null;
  let pageFit = 1;
  let viewZoom = 1;
  let controllers = [];
  let adjustingCell = null;
  let selected = null;
  let drag = null;
  let swap = null;
  let freeMove = null;
  let ignoreClick = false;
  let placeNote = "";
  const histories = {};
  const ownedUrls = new Set();

  function sheetScale() {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--scale"));
    return value > 0 ? value : 1;
  }

  function applyViewScale() {
    const scale = pageFit * viewZoom;
    document.documentElement.style.setProperty("--scale", String(scale > 0 ? scale : 1));
    const label = document.getElementById("view-fit");
    const outButton = document.getElementById("view-out");
    const inButton = document.getElementById("view-in");
    if (label) label.textContent = Math.round(viewZoom * 100) + "%";
    if (outButton) outButton.disabled = viewZoom <= viewMin + 0.001;
    if (inButton) inButton.disabled = viewZoom >= viewMax - 0.001;
    controllers.forEach(function (controller) {
      controller.layout();
    });
  }

  function setViewZoom(value) {
    viewZoom = Math.max(viewMin, Math.min(viewMax, value));
    applyViewScale();
  }

  function sizeFromHash() {
    const key = location.hash.replace("#", "");
    if (key === "livre") return "livre";
    return SIZES[key] ? key : "32";
  }

  function slotsFor(key) {
    if (key === "livre") {
      if (!memory.livre) memory.livre = [];
      return memory.livre;
    }
    const spec = SIZES[key];
    const total = spec.places ? spec.places.length : spec.cols * spec.rows;
    if (!memory[key] || memory[key].length !== total) {
      memory[key] = Array.from({ length: total }, function () {
        return { url: null, scale: fitScale, x: 0, y: 0, rotation: 0, brightness: 1, saturation: 1 };
      });
    }
    return memory[key];
  }

  function syncHash(key) {
    const next = key === "32" ? location.pathname + location.search : location.pathname + location.search + "#" + key;
    const current = location.pathname + location.search + location.hash;
    if (current !== next) history.replaceState(null, "", next);
  }

  function setSizePressed(key) {
    document.querySelectorAll("[data-size]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.size === key ? "true" : "false");
    });
  }

  function syncThemeButton() {
    const dark = document.documentElement.dataset.theme === "dark";
    if (!themeButton) return;
    themeButton.setAttribute("aria-pressed", dark ? "true" : "false");
    themeButton.setAttribute("aria-label", dark ? "Usar tema claro" : "Usar tema escuro");
    themeButton.title = dark ? "Tema claro" : "Tema escuro";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#1c1917" : "#faf8f5");
  }

  function setTheme(theme) {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("may-bottons-theme", theme);
    } catch (error) {}
    syncThemeButton();
  }

  if (themeButton) {
    themeButton.addEventListener("click", function () {
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
    syncThemeButton();
  }

  function updateCount() {
    if (currentKey === "livre") {
      const total = slotsFor("livre").length;
      const noun = total === 1 ? "botton" : "bottons";
      countLabel.textContent = placeNote || (total + " " + noun);
      return;
    }
    const slots = slotsFor(currentKey);
    const filled = slots.filter(function (state) {
      return state.url;
    }).length;
    countLabel.textContent = filled + " de " + slots.length + " · corte " + SIZES[currentKey].cut + " mm";
  }

  function syncInspector() {
    const active = selected || null;
    inspector.hidden = !active;
    document.body.classList.toggle("has-selection", Boolean(active));
    if (!active) return;
    const adjusting = active.isAdjusting();
    const hasPhoto = Boolean(active.state.url);
    adjustButton.textContent = adjusting ? "Concluir" : "Mover";
    adjustButton.classList.toggle("is-on", adjusting);
    adjustButton.disabled = !hasPhoto;
    document.getElementById("center").disabled = !hasPhoto;
    document.getElementById("rotate-left").disabled = !hasPhoto;
    document.getElementById("rotate-right").disabled = !hasPhoto;
    zoomInput.disabled = !hasPhoto;
    rotationInput.disabled = !hasPhoto;
    brightnessInput.disabled = !hasPhoto;
    saturationInput.disabled = !hasPhoto;
    inspectorHint.textContent = adjusting
      ? adjustHint()
      : hasPhoto
        ? copyHint()
        : "O centro escolhe a foto.";
    zoomInput.value = String(active.state.scale);
    rotationInput.value = String(normalizeRotation(active.state.rotation));
    brightnessInput.value = String(active.state.brightness);
    saturationInput.value = String(active.state.saturation);
    updateReadouts();
  }

  function updateReadouts() {
    const zoomValue = document.getElementById("zoom-value");
    const rotationValue = document.getElementById("rotation-value");
    const brightnessValue = document.getElementById("brightness-value");
    const saturationValue = document.getElementById("saturation-value");
    if (zoomValue) zoomValue.textContent = Math.round(Number(zoomInput.value) * 100) + "%";
    if (rotationValue) rotationValue.textContent = Math.round(Number(rotationInput.value)) + "°";
    if (brightnessValue) brightnessValue.textContent = Math.round(Number(brightnessInput.value) * 100) + "%";
    if (saturationValue) saturationValue.textContent = Math.round(Number(saturationInput.value) * 100) + "%";
  }

  function normalizeRotation(value) {
    const angle = ((Number(value) || 0) % 360 + 360) % 360;
    return Math.round(angle * 100) / 100;
  }

  function select(controller) {
    if (!controller) {
      deselect();
      return;
    }
    if (selected && selected !== controller) {
      selected.cell.classList.remove("is-selected");
      if (selected.isAdjusting()) selected.stopAdjust();
    }
    selected = controller;
    controller.cell.classList.add("is-selected");
    syncInspector();
    fit();
  }

  function deselect() {
    if (selected) {
      if (selected.isAdjusting()) selected.stopAdjust();
      selected.cell.classList.remove("is-selected");
    }
    selected = null;
    syncInspector();
    fit();
  }

  function render(key) {
    if (key !== "livre" && !SIZES[key]) key = "32";
    if (adjustingCell) adjustingCell.stopAdjust();
    endSwap();
    if (freeMove && freeMove.ghost) freeMove.ghost.remove();
    freeMove = null;
    pinch = null;
    selected = null;
    drag = null;
    currentKey = key;
    placeNote = "";
    const addSizes = document.getElementById("add-sizes");
    if (addSizes) addSizes.hidden = key !== "livre";
    if (key !== "livre") setAddOpen(false);
    sheet.classList.toggle("is-free", key === "livre");
    sheet.classList.toggle("is-placed", Boolean(SIZES[key] && SIZES[key].places));
    setSizePressed(key);
    sheet.replaceChildren();
    if (key === "livre") {
      if (sizeMark) sizeMark.textContent = "Livre";
      sheet.style.gridTemplateColumns = "";
      sheet.style.gridTemplateRows = "";
      controllers = slotsFor(key).map(function (state) {
        return createCell(state);
      });
    } else {
      const spec = SIZES[key];
      if (sizeMark) sizeMark.textContent = spec.diameter + " mm";
      document.documentElement.style.setProperty("--diameter", spec.diameter + "mm");
      document.documentElement.style.setProperty("--cut", spec.cut + "mm");
      if (spec.gap != null) document.documentElement.style.setProperty("--gap", spec.gap + "mm");
      if (spec.places) {
        sheet.style.gridTemplateColumns = "";
        sheet.style.gridTemplateRows = "";
        controllers = slotsFor(key).map(function (state, index) {
          const controller = createCell(state);
          const place = spec.places[index];
          controller.cell.style.left = place[0] + "mm";
          controller.cell.style.top = place[1] + "mm";
          controller.cell.style.width = spec.cut + "mm";
          controller.cell.style.height = spec.cut + "mm";
          return controller;
        });
      } else {
        sheet.style.gridTemplateColumns = "repeat(" + spec.cols + ", " + spec.cut + "mm)";
        sheet.style.gridTemplateRows = "repeat(" + spec.rows + ", " + spec.cut + "mm)";
        controllers = slotsFor(key).map(function (state) {
          return createCell(state);
        });
      }
    }
    syncInspector();
    updateCount();
    updateUndo();
    fit();
  }

  function createCell(state) {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (state.size && SIZES[state.size]) {
      cell.style.setProperty("--diameter", SIZES[state.size].diameter + "mm");
      cell.style.left = state.left + "mm";
      cell.style.top = state.top + "mm";
      cell.style.width = SIZES[state.size].cut + "mm";
      cell.style.height = SIZES[state.size].cut + "mm";
    }

    const frame = document.createElement("div");
    frame.className = "frame";

    const img = document.createElement("img");
    img.alt = "";
    img.hidden = true;
    img.draggable = false;

    const cut = document.createElement("div");
    cut.className = "cut";

    const circle = document.createElement("div");
    circle.className = "circle";

    const addMark = document.createElement("div");
    addMark.className = "add-mark";
    addMark.setAttribute("aria-hidden", "true");

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "pick";
    pick.setAttribute("aria-label", "Escolher foto");

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.hidden = true;
    input.tabIndex = -1;

    frame.appendChild(img);
    cell.append(frame, cut, circle, addMark, pick, input);
    sheet.appendChild(cell);

    const controller = {
      cell: cell,
      frame: frame,
      state: state,
      layout: layoutImage,
      stopAdjust: stopAdjust,
      startAdjust: startAdjust,
      isAdjusting: function () {
        return cell.classList.contains("is-adjusting");
      },
      clearImage: clearImage,
      setImage: setImage,
      zoomAt: zoomAt,
      setScale: setScale,
      setRotation: setRotation,
      rotateBy: rotateBy,
      setBrightness: setBrightness,
      setSaturation: setSaturation,
      center: center,
      nudge: nudge,
      showState: showState,
      pickFile: function () {
        input.click();
      }
    };
    cell.controller = controller;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function applyTone() {
      state.brightness = clamp(state.brightness == null ? 1 : state.brightness, minBrightness, maxBrightness);
      state.saturation = clamp(state.saturation == null ? 1 : state.saturation, minSaturation, maxSaturation);
      img.style.filter = "brightness(" + state.brightness + ") saturate(" + state.saturation + ")";
      if (selected === controller) {
        brightnessInput.value = String(state.brightness);
        saturationInput.value = String(state.saturation);
      }
    }

    function layoutImage() {
      applyTone();
      state.rotation = normalizeRotation(state.rotation);
      if (img.hidden || !img.naturalWidth) return;
      const frameW = frame.offsetWidth;
      const frameH = frame.offsetHeight;
      if (!frameW || !frameH) return;
      const cover = Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight);
      const width = img.naturalWidth * cover * state.scale;
      const height = img.naturalHeight * cover * state.scale;
      const maxX = Math.max(width, frameW) / 2;
      const maxY = Math.max(height, frameH) / 2;
      state.x = Math.max(-maxX, Math.min(maxX, state.x));
      state.y = Math.max(-maxY, Math.min(maxY, state.y));
      img.style.width = width + "px";
      img.style.height = height + "px";
      img.style.left = (frameW - width) / 2 + state.x + "px";
      img.style.top = (frameH - height) / 2 + state.y + "px";
      img.style.transformOrigin = "center center";
      img.style.transform = "rotate(" + state.rotation + "deg)";
      if (selected === controller) {
        zoomInput.value = String(state.scale);
        rotationInput.value = String(state.rotation);
        updateReadouts();
      }
    }

    function showImage() {
      img.hidden = false;
      cell.classList.add("has-image");
      if (img.complete && img.naturalWidth) layoutImage();
    }

    function showState() {
      if (state.url) {
        cell.classList.add("has-image");
        img.hidden = false;
        if (img.src !== state.url) img.src = state.url;
        else if (img.complete && img.naturalWidth) layoutImage();
        else applyTone();
      } else {
        img.removeAttribute("src");
        img.hidden = true;
        img.style.width = "";
        img.style.height = "";
        img.style.left = "";
        img.style.top = "";
        img.style.transform = "";
        img.style.filter = "";
        cell.classList.remove("has-image");
      }
    }

    function stopAdjust() {
      cell.classList.remove("is-adjusting");
      frame.classList.remove("is-dragging");
      if (adjustingCell === controller) adjustingCell = null;
      if (selected === controller) syncInspector();
    }

    function startAdjust() {
      if (!state.url) return;
      if (adjustingCell && adjustingCell !== controller) adjustingCell.stopAdjust();
      cell.classList.add("is-adjusting");
      adjustingCell = controller;
      select(controller);
    }

    function clearImage(options) {
      const record = !options || options.record !== false;
      if (record && state.url) pushHistory(currentKey);
      stopAdjust();
      state.url = null;
      state.scale = fitScale;
      state.x = 0;
      state.y = 0;
      state.rotation = 0;
      state.brightness = 1;
      state.saturation = 1;
      img.removeAttribute("src");
      img.hidden = true;
      img.style.width = "";
      img.style.height = "";
      img.style.left = "";
      img.style.top = "";
      img.style.transform = "";
      img.style.filter = "";
      input.value = "";
      cell.classList.remove("has-image");
      if (selected === controller) deselect();
      if (currentKey) updateCount();
      if (record) releaseUnused();
    }

    function setImage(file, options) {
      const record = !options || options.record !== false;
      if (record) pushHistory(currentKey);
      stopAdjust();
      const url = URL.createObjectURL(file);
      ownedUrls.add(url);
      state.url = url;
      state.scale = fitScale;
      state.x = 0;
      state.y = 0;
      state.rotation = 0;
      state.brightness = 1;
      state.saturation = 1;
      img.src = state.url;
      showImage();
      placeNote = "";
      updateCount();
      select(controller);
      if (record) releaseUnused();
    }

    function setScale(value) {
      state.scale = Math.max(minScale, Math.min(maxScale, value));
      layoutImage();
    }

    function setRotation(value) {
      state.rotation = normalizeRotation(value);
      layoutImage();
    }

    function rotateBy(delta) {
      state.rotation = normalizeRotation((state.rotation || 0) + delta);
      layoutImage();
    }

    function setBrightness(value) {
      state.brightness = clamp(value, minBrightness, maxBrightness);
      applyTone();
    }

    function setSaturation(value) {
      state.saturation = clamp(value, minSaturation, maxSaturation);
      applyTone();
    }

    function center() {
      state.scale = fitScale;
      state.x = 0;
      state.y = 0;
      state.rotation = 0;
      state.brightness = 1;
      state.saturation = 1;
      layoutImage();
    }

    function nudge(dx, dy) {
      state.x += dx;
      state.y += dy;
      layoutImage();
    }

    function zoomAt(event) {
      if (!controller.isAdjusting() || img.hidden || !img.naturalWidth) return;
      const frameW = frame.offsetWidth;
      const frameH = frame.offsetHeight;
      const rect = frame.getBoundingClientRect();
      const zoom = sheetScale();
      const pointX = (event.clientX - rect.left) / zoom - frameW / 2;
      const pointY = (event.clientY - rect.top) / zoom - frameH / 2;
      const localX = (pointX - state.x) / state.scale;
      const localY = (pointY - state.y) / state.scale;
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      state.scale = Math.max(minScale, Math.min(maxScale, state.scale * factor));
      state.x = pointX - localX * state.scale;
      state.y = pointY - localY * state.scale;
      layoutImage();
    }

    img.addEventListener("load", layoutImage);

    cell.addEventListener("click", function (event) {
      if (ignoreClick || drag || controller.isAdjusting()) return;
      if (!state.url && event.target.closest(".pick")) {
        select(controller);
        input.click();
        return;
      }
      select(controller);
    });

    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (file) setImage(file);
    });

    if (state.url) {
      img.src = state.url;
      showImage();
    }

    return controller;
  }

  function adjustHint() {
    if (window.matchMedia("(pointer: coarse)").matches) return "Arraste a foto. Pinçe para ampliar.";
    return "Arraste a foto. Use a roda ou o controle para ampliar.";
  }

  function copyHint() {
    if (currentKey === "livre") return "Arraste para mudar de lugar. Segure Control e solte num espaço livre para copiar.";
    const mode = touchCopyMode();
    if (mode === "fingers") return "Arraste para trocar de lugar. Com dois dedos, copia. Pinçe para ampliar a folha.";
    if (mode === "hold") return "Arraste para trocar de lugar. Segure um instante para copiar. Pinçe para ampliar a folha.";
    return "Arraste para outra posição para trocar de lugar. Segure Control para copiar.";
  }

  function touchCopyMode() {
    if (!window.matchMedia("(pointer: coarse)").matches) return "control";
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    return shortSide >= 600 ? "fingers" : "hold";
  }

  function cellAtPoint(x, y) {
    const cells = sheet.querySelectorAll(".cell");
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      const rect = cells[i].getBoundingClientRect();
      const dx = x - (rect.left + rect.width / 2);
      const dy = y - (rect.top + rect.height / 2);
      const radius = rect.width / 2;
      if (dx * dx + dy * dy <= radius * radius) return cells[i].controller;
    }
    return null;
  }

  function otherCircles(state) {
    return slotsFor("livre").filter(function (other) {
      return other !== state;
    }).map(function (other) {
      const cut = SIZES[other.size].cut;
      return { x: other.left + cut / 2, y: other.top + cut / 2, r: cut / 2 };
    });
  }

  function circleFits(cx, cy, radius, others) {
    if (cx - radius < pageMargin - 0.001 || cy - radius < pageMargin - 0.001) return false;
    if (cx + radius > pageWidth - pageMargin + 0.001 || cy + radius > pageHeight - pageMargin + 0.001) return false;
    return others.every(function (other) {
      const dx = cx - other.x;
      const dy = cy - other.y;
      const min = radius + other.r;
      return dx * dx + dy * dy >= min * min - 0.01;
    });
  }

  function findSpot(size) {
    const radius = SIZES[size].cut / 2;
    const others = otherCircles(null);
    const min = pageMargin + radius;
    const maxX = pageWidth - pageMargin - radius;
    const maxY = pageHeight - pageMargin - radius;
    for (let cy = min; cy <= maxY + 0.001; cy += 1) {
      for (let cx = min; cx <= maxX + 0.001; cx += 1) {
        if (circleFits(cx, cy, radius, others)) return { left: cx - radius, top: cy - radius };
      }
    }
    return null;
  }

  function resolveFree(state, left, top) {
    const radius = SIZES[state.size].cut / 2;
    let cx = left + radius;
    let cy = top + radius;
    const others = otherCircles(state);
    for (let pass = 0; pass < 8; pass += 1) {
      others.forEach(function (other) {
        let dx = cx - other.x;
        let dy = cy - other.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        const min = radius + other.r;
        if (dist < min) {
          if (dist < 0.001) {
            dx = 1;
            dy = 0;
            dist = 1;
          }
          cx = other.x + (dx / dist) * min;
          cy = other.y + (dy / dist) * min;
        }
      });
      cx = Math.max(pageMargin + radius, Math.min(pageWidth - pageMargin - radius, cx));
      cy = Math.max(pageMargin + radius, Math.min(pageHeight - pageMargin - radius, cy));
    }
    if (!circleFits(cx, cy, radius, others)) return null;
    return { left: cx - radius, top: cy - radius };
  }

  function placeFreeCell(controller) {
    controller.cell.style.left = controller.state.left + "mm";
    controller.cell.style.top = controller.state.top + "mm";
  }

  function addFree(size) {
    if (!SIZES[size] || currentKey !== "livre") return;
    const spot = findSpot(size);
    if (!spot) {
      placeNote = "Não cabe um de " + size + " mm";
      updateCount();
      return;
    }
    placeNote = "";
    pushHistory("livre");
    const state = {
      size: size,
      left: spot.left,
      top: spot.top,
      url: null,
      scale: fitScale,
      x: 0,
      y: 0,
      rotation: 0,
      brightness: 1,
      saturation: 1
    };
    slotsFor("livre").push(state);
    controllers.push(createCell(state));
    updateCount();
    updateUndo();
  }

  function removeFree(controller) {
    if (!controller) return;
    pushHistory("livre");
    if (controller.isAdjusting()) controller.stopAdjust();
    const index = slotsFor("livre").indexOf(controller.state);
    if (index >= 0) slotsFor("livre").splice(index, 1);
    controller.cell.remove();
    controllers = controllers.filter(function (item) {
      return item !== controller;
    });
    placeNote = "";
    if (selected === controller) deselect();
    updateCount();
    releaseUnused();
    updateUndo();
  }

  function mmPerPx() {
    const rect = sheet.getBoundingClientRect();
    return rect.width > 0 ? pageWidth / rect.width : 1;
  }

  function clampCopySpot(state, left, top) {
    const radius = SIZES[state.size].cut / 2;
    let cx = left + radius;
    let cy = top + radius;
    cx = Math.max(pageMargin + radius, Math.min(pageWidth - pageMargin - radius, cx));
    cy = Math.max(pageMargin + radius, Math.min(pageHeight - pageMargin - radius, cy));
    return {
      left: cx - radius,
      top: cy - radius,
      fits: circleFits(cx, cy, radius, otherCircles(state))
    };
  }

  function restoreFreeOrigin() {
    const state = freeMove.controller.state;
    state.left = freeMove.originLeft;
    state.top = freeMove.originTop;
    freeMove.lastLeft = freeMove.originLeft;
    freeMove.lastTop = freeMove.originTop;
    placeFreeCell(freeMove.controller);
  }

  function ensureFreeGhost() {
    if (freeMove.ghost) return;
    const ghost = document.createElement("div");
    const cell = freeMove.controller.cell;
    const img = cell.querySelector("img");
    ghost.className = "swap-ghost is-free-copy is-copy";
    if (img && !img.hidden && (img.currentSrc || img.src)) {
      const copy = document.createElement("img");
      const rect = cell.getBoundingClientRect();
      const scale = cell.offsetWidth ? rect.width / cell.offsetWidth : 1;
      copy.alt = "";
      copy.src = img.currentSrc || img.src;
      copy.style.filter = img.style.filter;
      copy.style.transform = img.style.transform;
      copy.style.transformOrigin = "center center";
      if (img.style.width) {
        copy.style.width = (parseFloat(img.style.width) * scale) + "px";
        copy.style.height = (parseFloat(img.style.height) * scale) + "px";
        copy.style.left = ((parseFloat(img.style.left) || 0) * scale) + "px";
        copy.style.top = ((parseFloat(img.style.top) || 0) * scale) + "px";
      }
      ghost.appendChild(copy);
    }
    ghost.style.fontSize = "16px";
    document.body.appendChild(ghost);
    freeMove.ghost = ghost;
  }

  function placeFreeGhost(left, top, fits) {
    const rect = sheet.getBoundingClientRect();
    const px = rect.width / pageWidth;
    const cut = SIZES[freeMove.controller.state.size].cut;
    const ghost = freeMove.ghost;
    ghost.style.left = (rect.left + left * px) + "px";
    ghost.style.top = (rect.top + top * px) + "px";
    ghost.style.width = (cut * px) + "px";
    ghost.style.height = (cut * px) + "px";
    ghost.classList.toggle("is-blocked", !fits);
  }

  function clearFreeGhost() {
    if (!freeMove || !freeMove.ghost) return;
    freeMove.ghost.remove();
    freeMove.ghost = null;
  }

  function placeCopy(snapshot, url) {
    const state = {
      size: snapshot.size,
      left: snapshot.left,
      top: snapshot.top,
      url: url,
      scale: snapshot.scale,
      x: snapshot.x,
      y: snapshot.y,
      rotation: snapshot.rotation,
      brightness: snapshot.brightness,
      saturation: snapshot.saturation
    };
    if (url) ownedUrls.add(url);
    slotsFor("livre").push(state);
    controllers.push(createCell(state));
    placeNote = "";
    updateCount();
    updateUndo();
    const live = controllers[controllers.length - 1];
    if (live) select(live);
  }

  function duplicateFree(source, left, top) {
    if (slotsFor("livre").indexOf(source.state) < 0) return;
    const sourceState = source.state;
    const snapshot = {
      size: sourceState.size,
      left: left,
      top: top,
      scale: sourceState.scale,
      x: sourceState.x,
      y: sourceState.y,
      rotation: normalizeRotation(sourceState.rotation),
      brightness: sourceState.brightness == null ? 1 : sourceState.brightness,
      saturation: sourceState.saturation == null ? 1 : sourceState.saturation
    };
    if (!sourceState.url) {
      placeCopy(snapshot, null);
      return;
    }
    const from = sourceState.url;
    const mark = histories.livre ? histories.livre.length : 0;
    fetch(from).then(function (response) {
      return response.blob();
    }).then(function (blob) {
      if (currentKey !== "livre" || slotsFor("livre").indexOf(sourceState) < 0) return;
      placeCopy(snapshot, URL.createObjectURL(blob));
    }).catch(function () {
      const stack = histories.livre;
      if (stack && stack.length === mark) stack.pop();
      updateUndo();
    });
  }

  function syncFreeDrag(clientX, clientY, copying) {
    const mm = mmPerPx();
    const left = freeMove.originLeft + (clientX - freeMove.startX) * mm;
    const top = freeMove.originTop + (clientY - freeMove.startY) * mm;
    freeMove.pointerX = clientX;
    freeMove.pointerY = clientY;
    if (copying) {
      restoreFreeOrigin();
      freeMove.controller.cell.classList.remove("is-free-moving");
      ensureFreeGhost();
      const spot = clampCopySpot(freeMove.controller.state, left, top);
      freeMove.copying = true;
      freeMove.spot = spot;
      placeFreeGhost(spot.left, spot.top, spot.fits);
      return;
    }
    clearFreeGhost();
    freeMove.copying = false;
    freeMove.spot = null;
    freeMove.controller.cell.classList.add("is-free-moving");
    const resolved = resolveFree(freeMove.controller.state, left, top);
    const next = resolved || { left: freeMove.lastLeft, top: freeMove.lastTop };
    freeMove.controller.state.left = next.left;
    freeMove.controller.state.top = next.top;
    freeMove.lastLeft = next.left;
    freeMove.lastTop = next.top;
    placeFreeCell(freeMove.controller);
  }

  function moveFree(event) {
    const dx = event.clientX - freeMove.startX;
    const dy = event.clientY - freeMove.startY;
    if (!freeMove.active) {
      if (dx * dx + dy * dy < 36) return;
      freeMove.active = true;
      pushHistory(currentKey);
    }
    syncFreeDrag(event.clientX, event.clientY, Boolean(event.ctrlKey));
  }

  function finishFree(event) {
    if (!freeMove || event.pointerId !== freeMove.pointerId) return;
    const source = freeMove.controller;
    const active = freeMove.active;
    const copying = Boolean(event.ctrlKey);
    if (copying && active) syncFreeDrag(event.clientX, event.clientY, true);
    const spot = freeMove.spot;
    if (copying) restoreFreeOrigin();
    source.cell.classList.remove("is-free-moving");
    clearFreeGhost();
    if (active) {
      ignoreClick = true;
      setTimeout(function () {
        ignoreClick = false;
      }, 0);
    }
    const moved = active && !copying && (
      Math.abs(source.state.left - freeMove.originLeft) > 0.05 ||
      Math.abs(source.state.top - freeMove.originTop) > 0.05
    );
    const copied = active && copying && spot && spot.fits;
    if (active && !moved && !copied) {
      const stack = histories[currentKey];
      if (stack && stack.length) stack.pop();
      updateUndo();
    }
    freeMove = null;
    if (copied) duplicateFree(source, spot.left, spot.top);
  }

  function pushHistory(key) {
    if (!key) return;
    if (!histories[key]) histories[key] = [];
    histories[key].push(slotsFor(key).map(function (state) {
      return {
        size: state.size,
        left: state.left,
        top: state.top,
        url: state.url,
        scale: state.scale,
        x: state.x,
        y: state.y,
        rotation: normalizeRotation(state.rotation),
        brightness: state.brightness == null ? 1 : state.brightness,
        saturation: state.saturation == null ? 1 : state.saturation
      };
    }));
    if (histories[key].length > 30) histories[key].shift();
    updateUndo();
  }

  function urlsInUse() {
    const used = new Set();
    Object.keys(memory).forEach(function (key) {
      (memory[key] || []).forEach(function (state) {
        if (state.url) used.add(state.url);
      });
    });
    Object.keys(histories).forEach(function (key) {
      histories[key].forEach(function (snap) {
        snap.forEach(function (state) {
          if (state.url) used.add(state.url);
        });
      });
    });
    return used;
  }

  function releaseUnused() {
    const used = urlsInUse();
    ownedUrls.forEach(function (url) {
      if (!used.has(url)) {
        URL.revokeObjectURL(url);
        ownedUrls.delete(url);
      }
    });
  }

  function updateUndo() {
    const button = document.getElementById("undo");
    const stack = currentKey && histories[currentKey];
    if (button) button.disabled = !stack || !stack.length;
  }

  function undo() {
    const stack = histories[currentKey];
    if (!stack || !stack.length) return;
    const snap = stack.pop();
    if (adjustingCell) adjustingCell.stopAdjust();
    if (currentKey === "livre") {
      memory.livre = snap.map(function (saved) {
        return {
          size: saved.size,
          left: saved.left,
          top: saved.top,
          url: saved.url,
          scale: saved.scale,
          x: saved.x,
          y: saved.y,
          rotation: normalizeRotation(saved.rotation),
          brightness: saved.brightness,
          saturation: saved.saturation
        };
      });
      render("livre");
      releaseUnused();
      return;
    }
    snap.forEach(function (saved, index) {
      const state = slotsFor(currentKey)[index];
      state.url = saved.url;
      state.scale = saved.scale;
      state.x = saved.x;
      state.y = saved.y;
      state.rotation = normalizeRotation(saved.rotation);
      state.brightness = saved.brightness;
      state.saturation = saved.saturation;
    });
    controllers.forEach(function (controller) {
      controller.showState();
    });
    updateCount();
    releaseUnused();
    updateUndo();
    if (selected && selected.state.url) syncInspector();
    else deselect();
    fit();
  }

  function placeFiles(start, files) {
    const images = [];
    Array.from(files || []).forEach(function (file) {
      if (file.type.indexOf("image/") === 0) images.push(file);
    });
    if (!images.length || !start) return;
    const startIndex = controllers.indexOf(start);
    if (startIndex < 0) return;
    pushHistory(currentKey);
    images.forEach(function (file, offset) {
      const controller = controllers[startIndex + offset];
      if (controller) controller.setImage(file, { record: false });
    });
    releaseUnused();
    updateUndo();
  }

  function exchange(source, target) {
    pushHistory(currentKey);
    ["url", "scale", "x", "y", "rotation", "brightness", "saturation"].forEach(function (key) {
      const hold = source.state[key];
      source.state[key] = target.state[key];
      target.state[key] = hold;
    });
    if (source.isAdjusting()) source.stopAdjust();
    if (target.isAdjusting()) target.stopAdjust();
    source.showState();
    target.showState();
    updateCount();
    if (target.state.url) select(target);
    else deselect();
  }

  function copyOnto(source, target) {
    const from = source.state.url;
    const key = currentKey;
    const targetState = target.state;
    if (!from) return;
    fetch(from).then(function (response) {
      return response.blob();
    }).then(function (blob) {
      const url = URL.createObjectURL(blob);
      ownedUrls.add(url);
      pushHistory(key);
      targetState.url = url;
      targetState.scale = source.state.scale;
      targetState.x = source.state.x;
      targetState.y = source.state.y;
      targetState.rotation = normalizeRotation(source.state.rotation);
      targetState.brightness = source.state.brightness;
      targetState.saturation = source.state.saturation;
      const live = currentKey === key ? controllers.filter(function (controller) {
        return controller.state === targetState;
      })[0] : null;
      if (live) {
        if (live.isAdjusting()) live.stopAdjust();
        live.showState();
        updateCount();
        select(live);
      }
      releaseUnused();
      updateUndo();
    }).catch(function () {});
  }

  function clearSwapTarget() {
    if (!swap || !swap.over) return;
    swap.over.cell.classList.remove("is-swap-target");
    swap.over = null;
  }

  const pointers = new Map();
  let pinch = null;
  let pinchBlocksClick = false;

  function rememberPointer(event) {
    const onStage = Boolean(event.target.closest && event.target.closest(".stage"));
    const current = pointers.get(event.pointerId);
    if (current) {
      current.x = event.clientX;
      current.y = event.clientY;
      return;
    }
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      onStage: onStage
    });
  }

  function pinchDistance() {
    const pts = Array.from(pointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function pinchOnStage() {
    let found = false;
    pointers.forEach(function (point) {
      if (point.onStage) found = true;
    });
    return found;
  }

  function beginPinch() {
    if (!window.matchMedia("(pointer: coarse)").matches || !pinchOnStage()) return;
    const dist = pinchDistance();
    if (dist < 8) return;
    pinch = {
      dist: dist,
      view: viewZoom,
      scale: adjustingCell ? adjustingCell.state.scale : 1,
      photo: adjustingCell
    };
    pinchBlocksClick = true;
    ignoreClick = true;
  }

  function applyPinch() {
    if (!pinch) return;
    const dist = pinchDistance();
    if (!dist) return;
    const ratio = dist / pinch.dist;
    if (pinch.photo && pinch.photo.isAdjusting()) pinch.photo.setScale(pinch.scale * ratio);
    else setViewZoom(pinch.view * ratio);
  }

  function armCopy() {
    if (!swap) return;
    swap.copy = true;
    swap.controller.cell.classList.add("is-copy-armed");
    if (swap.ghost) swap.ghost.classList.add("is-copy");
    try {
      if (navigator.vibrate) navigator.vibrate(12);
    } catch (error) {
      return;
    }
  }

  function endSwap() {
    if (!swap) return;
    if (swap.holdTimer) clearTimeout(swap.holdTimer);
    clearSwapTarget();
    swap.controller.cell.classList.remove("is-swap-source");
    swap.controller.cell.classList.remove("is-copy-armed");
    document.body.classList.remove("is-swapping");
    if (swap.ghost) swap.ghost.remove();
    swap = null;
  }

  function beginSwapGhost(event) {
    const rect = swap.controller.cell.getBoundingClientRect();
    const img = swap.controller.frame.querySelector("img");
    const zoom = sheetScale();
    const laidOut = Boolean(img.style.width);
    const ghost = document.createElement("div");
    const copy = document.createElement("img");
    ghost.className = "swap-ghost";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    copy.alt = "";
    copy.src = img.currentSrc || img.src;
    copy.style.filter = img.style.filter;
    copy.style.transform = img.style.transform;
    copy.style.transformOrigin = "center center";
    copy.style.width = (laidOut ? parseFloat(img.style.width) * zoom : rect.width) + "px";
    copy.style.height = (laidOut ? parseFloat(img.style.height) * zoom : rect.height) + "px";
    copy.style.left = (parseFloat(img.style.left) || 0) * (laidOut ? zoom : 1) + "px";
    copy.style.top = (parseFloat(img.style.top) || 0) * (laidOut ? zoom : 1) + "px";
    ghost.appendChild(copy);
    if (event.ctrlKey || swap.copy) ghost.classList.add("is-copy");
    ghost.style.fontSize = Math.max(13, Math.round(rect.width * 0.24)) + "px";
    document.body.appendChild(ghost);
    swap.ghost = ghost;
    swap.ghost.style.left = event.clientX + "px";
    swap.ghost.style.top = event.clientY + "px";
  }

  function moveSwap(event) {
    const dx = event.clientX - swap.startX;
    const dy = event.clientY - swap.startY;
    if (!swap.active) {
      if (dx * dx + dy * dy < 36) return;
      if (swap.holdTimer) {
        clearTimeout(swap.holdTimer);
        swap.holdTimer = null;
      }
      swap.active = true;
      swap.controller.cell.classList.add("is-swap-source");
      document.body.classList.add("is-swapping");
      beginSwapGhost(event);
    }
    swap.ghost.style.left = event.clientX + "px";
    swap.ghost.style.top = event.clientY + "px";
    swap.ghost.classList.toggle("is-copy", Boolean(event.ctrlKey) || swap.copy);
    const over = cellAtPoint(event.clientX, event.clientY);
    const next = over && over !== swap.controller ? over : null;
    if (next === swap.over) return;
    clearSwapTarget();
    swap.over = next;
    if (next) next.cell.classList.add("is-swap-target");
  }

  function finishSwap(event) {
    if (!swap || event.pointerId !== swap.pointerId) return;
    const source = swap.controller;
    const target = swap.active ? swap.over : null;
    const moved = swap.active;
    const copying = Boolean(event.ctrlKey) || Boolean(swap.copy);
    endSwap();
    if (!moved) return;
    ignoreClick = true;
    setTimeout(function () {
      ignoreClick = false;
    }, 0);
    if (target && target !== source) {
      if (copying) copyOnto(source, target);
      else exchange(source, target);
    }
  }

  sheet.addEventListener("pointerdown", function (event) {
    if (pinch || pointers.size >= 2) return;
    if (event.button !== 0) return;
    const cell = event.target.closest(".cell");
    if (!cell || !sheet.contains(cell)) return;
    const controller = cell.controller;
    if (!controller) return;
    if (controller.isAdjusting()) {
      const index = controllers.indexOf(controller);
      drag = {
        controller: controller,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: slotsFor(currentKey)[index].x,
        originY: slotsFor(currentKey)[index].y
      };
      controller.frame.classList.add("is-dragging");
      event.preventDefault();
      return;
    }
    if (currentKey === "livre") {
      freeMove = {
        controller: controller,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originLeft: controller.state.left,
        originTop: controller.state.top,
        lastLeft: controller.state.left,
        lastTop: controller.state.top,
        pointerX: event.clientX,
        pointerY: event.clientY,
        ghost: null,
        copying: false,
        spot: null,
        active: false
      };
      return;
    }
    if (!controller.state.url || swap) return;
    swap = {
      controller: controller,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      over: null,
      ghost: null,
      copy: touchCopyMode() === "fingers" && pointers.size >= 2,
      holdTimer: null
    };
    if (swap.copy) swap.controller.cell.classList.add("is-copy-armed");
    if (touchCopyMode() === "hold") {
      swap.holdTimer = setTimeout(armCopy, 460);
    }
  });

  window.addEventListener("pointerdown", function (event) {
    rememberPointer(event);
    if (swap && swap.active && touchCopyMode() === "fingers" && pointers.size >= 2) {
      armCopy();
      return;
    }
    if (freeMove && freeMove.active) return;
    if (pointers.size >= 2 && !(swap && swap.active)) {
      if (swap) endSwap();
      if (freeMove) freeMove = null;
      if (drag) {
        drag.controller.frame.classList.remove("is-dragging");
        drag = null;
      }
      beginPinch();
    }
  }, true);

  window.addEventListener("pointermove", function (event) {
    if (pointers.has(event.pointerId)) {
      const point = pointers.get(event.pointerId);
      point.x = event.clientX;
      point.y = event.clientY;
    }
    if (pinch && pointers.size >= 2) {
      applyPinch();
      event.preventDefault();
      return;
    }
    if (drag && event.pointerId === drag.pointerId) {
      const index = controllers.indexOf(drag.controller);
      const state = slotsFor(currentKey)[index];
      const zoom = sheetScale();
      state.x = drag.originX + (event.clientX - drag.startX) / zoom;
      state.y = drag.originY + (event.clientY - drag.startY) / zoom;
      drag.controller.layout();
      return;
    }
    if (freeMove && event.pointerId === freeMove.pointerId) {
      moveFree(event);
      return;
    }
    if (!swap || event.pointerId !== swap.pointerId) return;
    moveSwap(event);
  }, { passive: false });

  function releasePointer(event) {
    pointers.delete(event.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (!pointers.size && pinchBlocksClick) {
      pinchBlocksClick = false;
      ignoreClick = true;
      setTimeout(function () {
        ignoreClick = false;
      }, 0);
    }
  }

  window.addEventListener("pointerup", function (event) {
    releasePointer(event);
    if (drag && event.pointerId === drag.pointerId) {
      drag.controller.frame.classList.remove("is-dragging");
      drag = null;
      return;
    }
    if (freeMove && event.pointerId === freeMove.pointerId) {
      finishFree(event);
      return;
    }
    finishSwap(event);
  });

  window.addEventListener("pointercancel", function (event) {
    releasePointer(event);
    if (drag && event.pointerId === drag.pointerId) {
      drag.controller.frame.classList.remove("is-dragging");
      drag = null;
      return;
    }
    if (freeMove && event.pointerId === freeMove.pointerId) {
      finishFree(event);
      return;
    }
    finishSwap(event);
  });

  sheet.addEventListener("contextmenu", function (event) {
    if (event.target.closest(".cell")) event.preventDefault();
  });

  let dropController = null;

  function draggingFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    return types && Array.from(types).indexOf("Files") !== -1;
  }

  function setDropTarget(controller) {
    if (dropController === controller) return;
    if (dropController) dropController.cell.classList.remove("is-drop-target");
    dropController = controller;
    if (controller) controller.cell.classList.add("is-drop-target");
  }

  document.addEventListener("dragover", function (event) {
    if (!draggingFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDropTarget(cellAtPoint(event.clientX, event.clientY));
  });

  document.addEventListener("drop", function (event) {
    if (!draggingFiles(event)) return;
    event.preventDefault();
    const controller = cellAtPoint(event.clientX, event.clientY);
    setDropTarget(null);
    if (!controller || !event.dataTransfer) return;
    placeFiles(controller, event.dataTransfer.files);
  });

  document.addEventListener("dragend", function () {
    setDropTarget(null);
  });

  sheet.addEventListener("wheel", function (event) {
    const frame = event.target.closest(".frame");
    if (!frame || !sheet.contains(frame)) return;
    const controller = frame.closest(".cell").controller;
    if (!controller || !controller.isAdjusting()) return;
    event.preventDefault();
    controller.zoomAt(event);
  }, { passive: false });

  document.getElementById("view-out").addEventListener("click", function () {
    const step = 0.25;
    setViewZoom(Math.ceil(viewZoom / step - 1.001) * step);
  });

  document.getElementById("view-in").addEventListener("click", function () {
    const step = 0.25;
    setViewZoom(Math.floor(viewZoom / step + 1.001) * step);
  });

  document.getElementById("view-fit").addEventListener("click", function () {
    setViewZoom(1);
  });

  document.querySelector(".stage").addEventListener("wheel", function (event) {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.target.closest(".is-adjusting")) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    setViewZoom(viewZoom * factor);
  }, { passive: false });

  document.querySelectorAll("[data-size]").forEach(function (button) {
    button.addEventListener("click", function () {
      syncHash(button.dataset.size);
      render(button.dataset.size);
    });
  });

  function setAddOpen(open) {
    const panel = document.getElementById("add-panel");
    const toggle = document.getElementById("add-toggle");
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  document.getElementById("add-toggle").addEventListener("click", function (event) {
    event.stopPropagation();
    const panel = document.getElementById("add-panel");
    setAddOpen(panel.hidden);
  });

  document.addEventListener("click", function (event) {
    const panel = document.getElementById("add-panel");
    if (!panel || panel.hidden) return;
    if (event.target.closest("#add-sizes")) return;
    setAddOpen(false);
  });

  document.querySelectorAll("[data-add]").forEach(function (button) {
    button.addEventListener("click", function () {
      addFree(button.dataset.add);
      setAddOpen(false);
    });
  });

  window.addEventListener("hashchange", function () {
    const key = sizeFromHash();
    if (key !== currentKey) render(key);
  });

  document.getElementById("inspector-close").addEventListener("click", deselect);

  document.getElementById("replace").addEventListener("click", function () {
    if (selected) selected.pickFile();
  });

  document.getElementById("adjust").addEventListener("click", function () {
    if (!selected) return;
    if (selected.isAdjusting()) selected.stopAdjust();
    else selected.startAdjust();
  });

  document.getElementById("remove").addEventListener("click", function () {
    if (!selected) return;
    if (currentKey === "livre" && !selected.state.url) removeFree(selected);
    else selected.clearImage();
  });

  document.getElementById("center").addEventListener("click", function () {
    if (selected) selected.center();
  });

  document.getElementById("rotate-left").addEventListener("click", function () {
    if (selected) selected.rotateBy(-90);
  });

  document.getElementById("rotate-right").addEventListener("click", function () {
    if (selected) selected.rotateBy(90);
  });

  zoomInput.addEventListener("input", function () {
    if (selected) selected.setScale(Number(zoomInput.value));
    updateReadouts();
  });

  rotationInput.addEventListener("input", function () {
    if (selected) selected.setRotation(Number(rotationInput.value));
    updateReadouts();
  });

  brightnessInput.addEventListener("input", function () {
    if (selected) selected.setBrightness(Number(brightnessInput.value));
    updateReadouts();
  });

  saturationInput.addEventListener("input", function () {
    if (selected) selected.setSaturation(Number(saturationInput.value));
    updateReadouts();
  });

  window.addEventListener("keydown", function (event) {
    if (event.key === "Control" && freeMove && freeMove.active) {
      syncFreeDrag(freeMove.pointerX, freeMove.pointerY, true);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }
    if (event.key === "Control" && swap && swap.ghost) swap.ghost.classList.add("is-copy");
    if (event.key === "Escape") {
      const panel = document.getElementById("add-panel");
      if (panel && !panel.hidden) {
        setAddOpen(false);
        return;
      }
    }
    if (event.key === "Escape" && adjustingCell) {
      adjustingCell.stopAdjust();
      return;
    }
    if (!selected || !selected.state.url) return;
    if (event.target.closest("input, textarea")) return;
    const step = selected.frame.offsetWidth * 0.03;
    const move = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }[event.key];
    if (!move) return;
    event.preventDefault();
    selected.nudge(move[0], move[1]);
  });

  window.addEventListener("keyup", function (event) {
    if (event.key === "Control" && freeMove && freeMove.active) {
      syncFreeDrag(freeMove.pointerX, freeMove.pointerY, false);
    }
    if (event.key === "Control" && swap && swap.ghost && !swap.copy) swap.ghost.classList.remove("is-copy");
  });

  document.getElementById("print").addEventListener("click", function () {
    if (adjustingCell) adjustingCell.stopAdjust();
    window.print();
  });

  window.addEventListener("beforeprint", function () {
    endSwap();
    document.documentElement.style.setProperty("--scale", "1");
    controllers.forEach(function (controller) {
      controller.layout();
    });
  });
  window.addEventListener("afterprint", fit);

  document.getElementById("undo").addEventListener("click", undo);

  document.getElementById("clear").addEventListener("click", function () {
    if (currentKey === "livre") {
      if (!slotsFor("livre").length) return;
      pushHistory("livre");
      memory.livre = [];
      render("livre");
      releaseUnused();
      return;
    }
    const filled = controllers.some(function (controller) {
      return controller.state.url;
    });
    if (!filled) return;
    pushHistory(currentKey);
    if (adjustingCell) adjustingCell.stopAdjust();
    controllers.forEach(function (controller) {
      controller.clearImage({ record: false });
    });
    deselect();
    updateCount();
    releaseUnused();
    updateUndo();
  });

  function fit() {
    const toolbar = document.querySelector(".toolbar");
    const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
    const stage = document.querySelector(".stage");
    const stageStyle = stage ? getComputedStyle(stage) : null;
    const padX = stageStyle ? parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight) : 0;
    const padTop = stageStyle ? parseFloat(stageStyle.paddingTop) : 0;
    const padBottom = stageStyle ? parseFloat(stageStyle.paddingBottom) : 0;
    const inspectorGap = 12;
    const inspectorBlock = inspector && !inspector.hidden
      ? Math.round(window.innerHeight - inspector.getBoundingClientRect().top + inspectorGap)
      : 0;
    document.documentElement.style.setProperty("--inspector-space", inspectorBlock ? inspectorBlock + "px" : "0px");
    const availW = document.documentElement.clientWidth - padX;
    const availH = window.innerHeight - toolbarHeight - padTop - (inspectorBlock || padBottom);
    const nextFit = Math.min(1, availW / sheet.offsetWidth, availH / sheet.offsetHeight);
    pageFit = nextFit > 0 ? nextFit : 1;
    applyViewScale();
  }

  window.addEventListener("resize", function () {
    if (selected) syncInspector();
    fit();
  });
  render(sizeFromHash());
  syncHash(currentKey);

  const installButton = document.getElementById("install");
  let installPrompt = null;

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", function () {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    prompt.prompt();
  });

  window.addEventListener("appinstalled", function () {
    installPrompt = null;
    installButton.hidden = true;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js");
  }
})();
