(function () {
  const SIZES = {
    "32": { diameter: 32, cut: 44, cols: 4, rows: 6, gap: 4 },
    "44": { diameter: 44, cut: 54, cols: 3, rows: 5, gap: 3.5 },
    "58": { diameter: 58, cut: 70, cols: 2, rows: 3, gap: 16 }
  };

  const minScale = 0.25;
  const fitScale = 1;
  const maxScale = 4;
  const sheet = document.getElementById("sheet");
  const heading = document.querySelector(".toolbar h1");
  const countLabel = document.getElementById("count");
  const inspector = document.getElementById("inspector");
  const inspectorHint = document.getElementById("inspector-hint");
  const adjustButton = document.getElementById("adjust");
  const zoomInput = document.getElementById("zoom");
  const rotationInput = document.getElementById("rotation");
  const brightnessInput = document.getElementById("brightness");
  const saturationInput = document.getElementById("saturation");
  const minBrightness = 0.4;
  const maxBrightness = 1.8;
  const minSaturation = 0;
  const maxSaturation = 2;
  const viewMin = 1;
  const viewMax = 3;
  const memory = {};
  let currentKey = null;
  let pageFit = 1;
  let viewZoom = 1;
  let controllers = [];
  let adjustingCell = null;
  let selected = null;
  let drag = null;
  let swap = null;
  let ignoreClick = false;
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
    return SIZES[key] ? key : "32";
  }

  function slotsFor(key) {
    const spec = SIZES[key];
    const total = spec.cols * spec.rows;
    if (!memory[key]) {
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

  function updateCount() {
    const slots = slotsFor(currentKey);
    const filled = slots.filter(function (state) {
      return state.url;
    }).length;
    countLabel.textContent = filled + " de " + slots.length + " · corte " + SIZES[currentKey].cut + " mm";
  }

  function syncInspector() {
    const active = selected && selected.state.url ? selected : null;
    inspector.hidden = !active;
    document.body.classList.toggle("has-selection", Boolean(active));
    if (!active) return;
    const adjusting = active.isAdjusting();
    adjustButton.textContent = adjusting ? "Concluir" : "Mover";
    adjustButton.classList.toggle("is-on", adjusting);
    inspectorHint.textContent = adjusting
      ? adjustHint()
      : copyHint();
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
    if (!controller || !controller.state.url) {
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
    if (!SIZES[key]) key = "32";
    if (adjustingCell) adjustingCell.stopAdjust();
    endSwap();
    pinch = null;
    selected = null;
    drag = null;
    currentKey = key;
    const spec = SIZES[key];
    const slots = slotsFor(key);
    const title = "May Bottons " + spec.diameter + " mm";

    if (heading) heading.textContent = title;
    setSizePressed(key);
    document.documentElement.style.setProperty("--diameter", spec.diameter + "mm");
    document.documentElement.style.setProperty("--cut", spec.cut + "mm");
    document.documentElement.style.setProperty("--gap", spec.gap + "mm");
    sheet.style.gridTemplateColumns = "repeat(" + spec.cols + ", " + spec.cut + "mm)";
    sheet.style.gridTemplateRows = "repeat(" + spec.rows + ", " + spec.cut + "mm)";
    sheet.replaceChildren();
    controllers = slots.map(function (state) {
      return createCell(state);
    });
    syncInspector();
    updateCount();
    updateUndo();
    fit();
  }

  function createCell(state) {
    const cell = document.createElement("div");
    cell.className = "cell";

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

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.hidden = true;
    input.tabIndex = -1;

    frame.appendChild(img);
    cell.append(frame, cut, circle, addMark, input);
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

    frame.addEventListener("click", function () {
      if (ignoreClick || drag || controller.isAdjusting()) return;
      if (state.url) select(controller);
      else input.click();
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

  function pushHistory(key) {
    if (!key) return;
    if (!histories[key]) histories[key] = [];
    histories[key].push(slotsFor(key).map(function (state) {
      return {
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
    const frame = event.target.closest(".frame");
    if (!frame || !sheet.contains(frame)) return;
    const controller = frame.closest(".cell").controller;
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
    if (pointers.size >= 2 && !(swap && swap.active)) {
      if (swap) endSwap();
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
    finishSwap(event);
  });

  window.addEventListener("pointercancel", function (event) {
    releasePointer(event);
    if (drag && event.pointerId === drag.pointerId) {
      drag.controller.frame.classList.remove("is-dragging");
      drag = null;
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
    if (selected) selected.clearImage();
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
      return;
    }
    if (event.key === "Control" && swap && swap.ghost) swap.ghost.classList.add("is-copy");
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
