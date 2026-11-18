(function () {
  const SIZES = {
    "32": { diameter: 32, cols: 5, rows: 7 },
    "44": { diameter: 44, cols: 4, rows: 5 },
    "58": { diameter: 58, cols: 3, rows: 4 }
  };

  const minScale = 1;
  const maxScale = 4;
  const sheet = document.getElementById("sheet");
  const heading = document.querySelector(".toolbar h1");
  const countLabel = document.getElementById("count");
  const inspector = document.getElementById("inspector");
  const inspectorHint = document.getElementById("inspector-hint");
  const adjustButton = document.getElementById("adjust");
  const zoomInput = document.getElementById("zoom");
  const brightnessInput = document.getElementById("brightness");
  const saturationInput = document.getElementById("saturation");
  const minBrightness = 0.4;
  const maxBrightness = 1.8;
  const minSaturation = 0;
  const maxSaturation = 2;
  const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--inset")) || 2;
  const memory = {};
  let currentKey = null;
  let controllers = [];
  let adjustingCell = null;
  let selected = null;
  let drag = null;

  function sheetScale() {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--scale"));
    return value > 0 ? value : 1;
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
        return { url: null, scale: minScale, x: 0, y: 0, brightness: 1, saturation: 1 };
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
    countLabel.textContent = filled + " de " + slots.length;
  }

  function syncInspector() {
    const active = selected && selected.state.url ? selected : null;
    inspector.hidden = !active;
    document.body.classList.toggle("has-selection", Boolean(active));
    if (!active) return;
    const adjusting = active.isAdjusting();
    adjustButton.textContent = adjusting ? "Concluir" : "Ajustar";
    adjustButton.classList.toggle("is-on", adjusting);
    inspectorHint.textContent = adjusting
      ? "Arraste a foto. Use a roda ou o controle para ampliar."
      : "Enquadre a foto deste botton.";
    zoomInput.value = String(active.state.scale);
    brightnessInput.value = String(active.state.brightness);
    saturationInput.value = String(active.state.saturation);
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
    selected = null;
    drag = null;
    currentKey = key;
    const spec = SIZES[key];
    const slots = slotsFor(key);
    const square = spec.diameter + inset * 2;
    const title = "Bottons " + spec.diameter + " mm";

    if (heading) heading.textContent = title;
    setSizePressed(key);
    document.documentElement.style.setProperty("--diameter", spec.diameter + "mm");
    sheet.style.gridTemplateColumns = "repeat(" + spec.cols + ", " + square + "mm)";
    sheet.style.gridTemplateRows = "repeat(" + spec.rows + ", " + square + "mm)";
    sheet.replaceChildren();
    controllers = slots.map(function (state) {
      return createCell(state);
    });
    syncInspector();
    updateCount();
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
    cell.append(frame, circle, addMark, input);
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
      zoomAt: zoomAt,
      setScale: setScale,
      setBrightness: setBrightness,
      setSaturation: setSaturation,
      center: center,
      nudge: nudge,
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
      if (img.hidden || !img.naturalWidth) return;
      const frameW = frame.offsetWidth;
      const frameH = frame.offsetHeight;
      if (!frameW || !frameH) return;
      const cover = Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight);
      const width = img.naturalWidth * cover * state.scale;
      const height = img.naturalHeight * cover * state.scale;
      const maxX = Math.max(0, (width - frameW) / 2);
      const maxY = Math.max(0, (height - frameH) / 2);
      state.x = Math.max(-maxX, Math.min(maxX, state.x));
      state.y = Math.max(-maxY, Math.min(maxY, state.y));
      img.style.width = width + "px";
      img.style.height = height + "px";
      img.style.left = (frameW - width) / 2 + state.x + "px";
      img.style.top = (frameH - height) / 2 + state.y + "px";
      if (selected === controller) zoomInput.value = String(state.scale);
    }

    function showImage() {
      img.hidden = false;
      cell.classList.add("has-image");
      if (img.complete && img.naturalWidth) layoutImage();
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

    function clearImage() {
      stopAdjust();
      if (state.url) {
        URL.revokeObjectURL(state.url);
        state.url = null;
      }
      state.scale = minScale;
      state.x = 0;
      state.y = 0;
      state.brightness = 1;
      state.saturation = 1;
      img.removeAttribute("src");
      img.hidden = true;
      img.style.width = "";
      img.style.height = "";
      img.style.left = "";
      img.style.top = "";
      img.style.filter = "";
      input.value = "";
      cell.classList.remove("has-image");
      if (selected === controller) deselect();
      if (currentKey) updateCount();
    }

    function setImage(file) {
      stopAdjust();
      if (state.url) URL.revokeObjectURL(state.url);
      state.url = URL.createObjectURL(file);
      state.scale = minScale;
      state.x = 0;
      state.y = 0;
      state.brightness = 1;
      state.saturation = 1;
      img.src = state.url;
      showImage();
      updateCount();
      select(controller);
    }

    function setScale(value) {
      state.scale = Math.max(minScale, Math.min(maxScale, value));
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
      state.scale = minScale;
      state.x = 0;
      state.y = 0;
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
      if (drag || controller.isAdjusting()) return;
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

  sheet.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) return;
    const frame = event.target.closest(".frame");
    if (!frame || !sheet.contains(frame)) return;
    const controller = frame.closest(".cell").controller;
    if (!controller || !controller.isAdjusting()) return;
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
  });

  window.addEventListener("pointermove", function (event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const index = controllers.indexOf(drag.controller);
    const state = slotsFor(currentKey)[index];
    const zoom = sheetScale();
    state.x = drag.originX + (event.clientX - drag.startX) / zoom;
    state.y = drag.originY + (event.clientY - drag.startY) / zoom;
    drag.controller.layout();
  });

  window.addEventListener("pointerup", function (event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.controller.frame.classList.remove("is-dragging");
    drag = null;
  });

  sheet.addEventListener("wheel", function (event) {
    const frame = event.target.closest(".frame");
    if (!frame || !sheet.contains(frame)) return;
    const controller = frame.closest(".cell").controller;
    if (!controller || !controller.isAdjusting()) return;
    event.preventDefault();
    controller.zoomAt(event);
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

  zoomInput.addEventListener("input", function () {
    if (selected) selected.setScale(Number(zoomInput.value));
  });

  brightnessInput.addEventListener("input", function () {
    if (selected) selected.setBrightness(Number(brightnessInput.value));
  });

  saturationInput.addEventListener("input", function () {
    if (selected) selected.setSaturation(Number(saturationInput.value));
  });

  window.addEventListener("keydown", function (event) {
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

  document.getElementById("print").addEventListener("click", function () {
    if (adjustingCell) adjustingCell.stopAdjust();
    window.print();
  });

  window.addEventListener("beforeprint", function () {
    document.documentElement.style.setProperty("--scale", "1");
    controllers.forEach(function (controller) {
      controller.layout();
    });
  });
  window.addEventListener("afterprint", fit);

  document.getElementById("clear").addEventListener("click", function () {
    controllers.forEach(function (controller) {
      controller.clearImage();
    });
    deselect();
    updateCount();
  });

  function fit() {
    const toolbar = document.querySelector(".toolbar");
    const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
    const stage = document.querySelector(".stage");
    const stageStyle = stage ? getComputedStyle(stage) : null;
    const padX = stageStyle ? parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight) : 0;
    const padY = stageStyle ? parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom) : 0;
    const availW = document.documentElement.clientWidth - padX;
    const availH = window.innerHeight - toolbarHeight - padY;
    const viewScale = Math.min(1, availW / sheet.offsetWidth, availH / sheet.offsetHeight);
    document.documentElement.style.setProperty("--scale", String(viewScale > 0 ? viewScale : 1));
    controllers.forEach(function (controller) {
      controller.layout();
    });
  }

  window.addEventListener("resize", fit);
  render(sizeFromHash());
  syncHash(currentKey);
})();
