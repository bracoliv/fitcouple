(function () {
  // ≤75% of estimated energy needs is the usual clinical flag for inadequate
  // intake (ASPEN / Academy of Nutrition and Dietetics; White et al., JPEN 2012).
  // Only applied once the day is finished, or after 8pm local, so breakfast
  // is not painted as a warning.
  var LOW_RATIO = 0.75;
  var LOW_HOUR = 20;
  var COLORS = ['#1a73e8', '#d81b60', '#0d7377', '#f57c00', '#7b1fa2', '#388e3c'];

  function ymd(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function todayStr(now) { return ymd(now || new Date()); }
  function addDays(base, n) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() + n);
    return d;
  }
  function num(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '').replace(/[^\d.-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function esc(s) {
    var out = '';
    var str = String(s == null ? '' : s);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c === 38) out += '&' + 'amp;';
      else if (c === 60) out += '&' + 'lt;';
      else if (c === 62) out += '&' + 'gt;';
      else if (c === 34) out += '&' + 'quot;';
      else if (c === 39) out += '&' + '#39;';
      else out += str.charAt(i);
    }
    return out;
  }
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '"') {
        if (q && text[i + 1] === '"') { cell += '"'; i++; }
        else q = !q;
      } else if (c === ',' && !q) {
        row.push(cell); cell = '';
      } else if ((c === '\n' || c === '\r') && !q) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (row.length || cell) { row.push(cell); rows.push(row); }
        row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
  }
  function extractId(url) {
    var m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : null;
  }
  function parseTargets(text) {
    var rows = parseCSV(text);
    var targets = [];
    for (var i = 0; i < rows.length; i++) {
      if (!/^person$/i.test(String(rows[i][0] || '').trim())) continue;
      for (var j = i + 1; j < rows.length; j++) {
        var name = String(rows[j][0] || '').trim();
        var cal = num(rows[j][1]);
        if (!name || !(cal > 0) || /[🎯📆📅💙💗🔥💪🍚🥑🏃📝🍗📈]/.test(name)) break;
        targets.push({
          name: name,
          cal: cal,
          prot: num(rows[j][2]),
          carbs: num(rows[j][3]),
          fat: num(rows[j][4])
        });
      }
      if (targets.length) break;
    }
    return targets;
  }
  function dayPhase(dateStr, now) {
    var clock = now || new Date();
    var today = todayStr(clock);
    if (dateStr > today) return 'future';
    if (dateStr < today) return 'past';
    return clock.getHours() >= LOW_HOUR ? 'late' : 'open';
  }
  function dayStatus(eaten, target, dateStr, now) {
    if (!(target > 0) || !(eaten > 0)) return 'empty';
    if (eaten > target) return 'over';
    var phase = dayPhase(dateStr, now);
    if ((phase === 'past' || phase === 'late') && eaten < target * LOW_RATIO) return 'low';
    if (phase === 'open' && eaten < target * LOW_RATIO) return 'partial';
    return 'ok';
  }

  var Fit = {
    ymd: ymd,
    todayStr: todayStr,
    addDays: addDays,
    num: num,
    esc: esc,
    parseCSV: parseCSV,
    parseTargets: parseTargets,
    dayStatus: dayStatus,
    dayPhase: dayPhase,
    LOW_RATIO: LOW_RATIO,
    LOW_HOUR: LOW_HOUR
  };
  if (typeof globalThis !== 'undefined') globalThis.Fit = Fit;
  if (typeof document === 'undefined' || !document.getElementById || !document.getElementById('sheetUrl')) return;

  var cfg = window.FIT_CONFIG || {};
  var allRows = [];
  var idx = {};
  var people = [];
  var goals = {};
  var sheetUrl = '';
  var targetSource = 'default';
  var dropped = 0;
  var medPeople = [];
  var pendingMedPrompt = '';

  function $(id) { return document.getElementById(id); }
  function defaultsAt(i) {
    var list = cfg.defaults && cfg.defaults.length ? cfg.defaults : [{ cal: 2000, prot: 120, carbs: 200, fat: 65 }];
    return list[Math.min(i, list.length - 1)];
  }
  function currentUrl() {
    var input = $('sheetUrl');
    return (input && input.value.trim()) || sheetUrl || localStorage.getItem(cfg.storageKey) || '';
  }
  function historyKey() { return cfg.storageKey + '_history'; }
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(historyKey()) || '[]'); }
    catch (e) { return []; }
  }
  function saveHistory(url) {
    if (!url) return;
    var h = getHistory().filter(function (x) { return x !== url; });
    h.unshift(url);
    localStorage.setItem(historyKey(), JSON.stringify(h.slice(0, 8)));
  }
  function renderHistory(list) {
    var el = $('linkHistory');
    if (!el) return;
    el.replaceChildren();
    if (!list.length) { el.style.display = 'none'; return; }
    list.forEach(function (u) {
      var div = document.createElement('div');
      div.textContent = u;
      div.addEventListener('click', function () {
        $('sheetUrl').value = u;
        el.style.display = 'none';
      });
      el.appendChild(div);
    });
    el.style.display = 'block';
  }
  function showError(msg) {
    ['error', 'appError'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.textContent = msg;
      el.hidden = false;
    });
  }
  function clearError() {
    ['error', 'appError'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.textContent = '';
      el.hidden = true;
    });
  }
  function closeMenus() {
    document.querySelectorAll('details.switcher').forEach(function (d) { d.open = false; });
    var menu = $('aiMenu');
    if (menu) menu.style.display = 'none';
  }
  function instructionText() {
    var url = currentUrl() || '[paste your sheet link here]';
    return 'You are helping me log food and workouts to my Google Sheet for ' + cfg.title + '.\n\n'
      + 'My sheet link: ' + url + '\n\n'
      + 'IMPORTANT: Open the sheet and read the README tab first. Follow those rules exactly.\n'
      + 'Do not invent rules. The README tab is the source of truth.\n'
      + 'This sheet is only for ' + cfg.title + '. Do not mix it with Solo, Couple, or Family.\n\n'
      + 'After reading README:\n'
      + '- Always APPEND new rows to the Log tab.\n'
      + '- Never edit or delete existing rows.\n'
      + '- When I send a photo, estimate, confirm if unsure, then append.\n\n'
      + 'Keep replies short.';
  }
  function openHowto() {
    closeMenus();
    var box = $('aiInstruction');
    if (box) box.textContent = instructionText();
    var title = $('howtoTitle');
    if (title) title.textContent = 'How to use ' + cfg.title;
    var warn = $('howtoWarn');
    if (warn) warn.textContent = 'Use a separate Google Sheet for ' + cfg.title + '. Do not post the sheet link online. This site does not store your sheet.';
    $('howtoModal').classList.add('open');
  }
  function sheetCsvUrl(id, sheet) {
    return 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv&sheet='
      + encodeURIComponent(sheet) + '&t=' + Date.now();
  }
  async function fetchText(url) {
    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  }
  function logNamesFromRows() {
    var names = [];
    var seen = {};
    if (idx.person < 0) return names;
    allRows.forEach(function (r) {
      var n = String(r[idx.person] || '').trim();
      if (!n || seen[n]) return;
      seen[n] = true;
      names.push(n);
    });
    return names;
  }
  function assignPeople(logNames, sheetTargets) {
    var max = cfg.variant === 'solo' ? 1 : (cfg.maxPeople || 6);
    var byName = {};
    sheetTargets.forEach(function (t) { byName[t.name.toLowerCase()] = t; });
    var matchedNames = [];
    var otherNames = [];
    logNames.forEach(function (n) {
      if (byName[n.toLowerCase()]) matchedNames.push(n);
      else otherNames.push(n);
    });
    matchedNames.sort(function (a, b) {
      var ia = sheetTargets.findIndex(function (t) { return t.name.toLowerCase() === a.toLowerCase(); });
      var ib = sheetTargets.findIndex(function (t) { return t.name.toLowerCase() === b.toLowerCase(); });
      return ia - ib;
    });
    var names = cfg.variant === 'solo'
      ? (logNames.length ? [logNames[0]] : ['Me'])
      : matchedNames.concat(otherNames);
    dropped = Math.max(0, names.length - max);
    names = names.slice(0, max);
    var nameHits = names.filter(function (n) { return byName[n.toLowerCase()]; }).length;
    var matched = 0;
    var ordered = 0;
    var fallback = 0;
    people = names.map(function (name, i) {
      var t = byName[name.toLowerCase()];
      if (t) matched++;
      else if (!nameHits && sheetTargets[i]) { t = sheetTargets[i]; ordered++; }
      else fallback++;
      if (!t) {
        return { name: name, goal: goals[name.toLowerCase()] || '', target: null };
      }
      return { name: name, goal: goals[name.toLowerCase()] || '', target: { cal: t.cal, prot: t.prot, carbs: t.carbs, fat: t.fat } };
    });
    if (matched && !fallback && !ordered) targetSource = 'sheet';
    else if (ordered && !matched) targetSource = 'sheet-order';
    else if (matched) targetSource = 'mixed';
    else targetSource = 'default';
  }
  function targetNoteText() {
    var extra = dropped > 0 ? ' Showing ' + people.length + ' people.' : '';
    if (targetSource === 'demo') {
      if (cfg.variant === 'couple') return 'Demo only. Husband 2,500 and Wife 2,000 are common adult averages, not your goals and not a recommendation.';
      return 'Demo only. These are not your goals.';
    }
    if (targetSource === 'sheet') return 'Your own targets, from your sheet. Not a recommendation from this site.' + extra;
    if (targetSource === 'sheet-order') return 'Your own targets, from your sheet, in row order, because the names do not match.' + extra;
    if (targetSource === 'mixed') return 'Where the name matches, the target is your own, from your sheet.' + extra;
    return 'No personal targets in the sheet yet. Fill the yellow Targets table. This site does not suggest targets.' + extra;
  }
  function getDayData(name, dateStr) {
    var eaten = 0, prot = 0, carbs = 0, fat = 0, workout = 0, entries = 0;
    allRows.forEach(function (r) {
      var d = String(r[idx.date] || '').trim();
      if (!d.startsWith(dateStr)) return;
      if (name && idx.person >= 0 && String(r[idx.person] || '').trim() !== name) return;
      var food = String(idx.food >= 0 ? r[idx.food] || '' : '').trim();
      var cal = num(r[idx.cal]);
      var p = idx.protein >= 0 ? num(r[idx.protein]) : 0;
      var c = idx.carbs >= 0 ? num(r[idx.carbs]) : 0;
      var f = idx.fat >= 0 ? num(r[idx.fat]) : 0;
      if (/^workout/i.test(food)) workout += cal;
      else { eaten += cal; prot += p; carbs += c; fat += f; entries++; }
    });
    return { eaten: eaten, prot: prot, carbs: carbs, fat: fat, workout: workout, entries: entries };
  }
  function calorieStatus(st, eaten, target) {
    var pct = target ? Math.round(eaten / target * 100) : 0;
    if (st === 'empty') return 'Nothing logged yet';
    if (st === 'over') return 'Over by ' + Math.round(eaten - target) + ' kcal';
    if (st === 'low') return 'Low intake · ' + pct + '% of target';
    if (st === 'partial') return Math.round(Math.max(0, target - eaten)) + ' kcal left · day still open';
    return 'On track';
  }
  function personEmoji(i) {
    if (cfg.variant === 'couple') return i === 0 ? '💙' : '💗';
    return '👤';
  }

  function shortGoal(raw) {
    if (!raw) return '';
    var s = String(raw).toLowerCase();
    if (/muscle|bulk|gain/.test(s)) return '💪 Build';
    if (/fat|cut|lose|lean/.test(s)) return '🔥 Cut';
    if (/maintain|keep/.test(s)) return '⚖️ Maintain';
    if (/recomp/.test(s)) return '🔄 Recomp';
    if (/diabet|sugar|glucose/.test(s)) return '🩸 Sugar';
    if (/pressure|hypertens|bp/.test(s)) return '❤️ BP';
    if (/cholesterol|lipid/.test(s)) return '💊 Lipid';
    if (/heart/.test(s)) return '❤️ Heart';
    if (/kidney/.test(s)) return '🫘 Kidney';
    if (/gout/.test(s)) return '⚠️ Gout';
    if (/health|well/.test(s)) return '🌿 Health';
    return String(raw).slice(0, 12);
  }
  function renderPersonCard(person, i, dateStr) {
    var d = getDayData(person.name, dateStr);
    var klass = 'person' + (cfg.variant === 'couple' ? ' p' + (i + 1) : '');
    var head = '<h3><span>' + personEmoji(i) + ' ' + esc(person.name) + '</span>'
      + (person.goal ? '<span class="goal-badge">' + esc(shortGoal(person.goal)) + '</span>' : '') + '</h3>';
    if (!person.target || !(person.target.cal > 0)) {
      return '<div class="' + klass + '">' + head
        + '<div class="metric"><span class="label">Calories eaten</span><strong>' + Math.round(d.eaten) + '</strong></div>'
        + '<div class="status empty">No personal target in your sheet yet.</div>'
        + '</div>';
    }
    var t = person.target;
    var st = dayStatus(d.eaten, t.cal, dateStr);
    var overBy = Math.max(0, d.eaten - t.cal);
    var rem = Math.max(0, t.cal - d.eaten);
    var pNeed = Math.max(0, t.prot - d.prot);
    var calPct = t.cal ? Math.round(d.eaten / t.cal * 100) : 0;
    var protPct = t.prot ? Math.round(d.prot / t.prot * 100) : 0;
    var carbPct = t.carbs ? Math.round(d.carbs / t.carbs * 100) : 0;
    var fatPct = t.fat ? Math.round(d.fat / t.fat * 100) : 0;
    var tip = pNeed > 0 ? '≈ ' + (Math.round(pNeed / 0.31 / 10) * 10) + ' g chicken breast' : 'Protein covered';
    var protStatus = pNeed <= 0 ? '<div class="status ok goal-hit">💪 Protein goal hit</div>' : '';
    var workoutTxt = d.workout ? Math.round(d.workout) + ' kcal burned' : 'no workout yet';
    var midLabel = overBy ? 'Over' : 'Remaining';
    var midVal = overBy ? Math.round(overBy) : Math.round(rem);
    var midClass = st === 'over' ? ' over' : (st === 'low' ? ' low' : '');
    return '<div class="' + klass + '">'
      + head
      + '<div class="metric"><span class="label">Calories eaten</span><strong>' + Math.round(d.eaten) + '</strong></div>'
      + '<div class="highlight-row">'
      + '<div class="highlight"><span class="h-label">Your goal</span><span class="h-val">' + Math.round(t.cal) + '</span></div>'
      + '<div class="highlight' + midClass + '"><span class="h-label">' + midLabel + '</span><span class="h-val">' + midVal + '</span></div>'
      + '<div class="highlight' + midClass + '"><span class="h-label">% of target</span><span class="h-val">' + calPct + '%</span></div>'
      + '</div>'
      + '<div class="status ' + st + '">' + esc(calorieStatus(st, d.eaten, t.cal)) + '</div>'
      + '<div class="metric"><span class="label">Protein</span><strong>' + Math.round(d.prot) + ' / ' + Math.round(t.prot) + ' g</strong></div>'
      + '<div class="highlight-row">'
      + '<div class="highlight"><span class="h-label">Your goal</span><span class="h-val">' + Math.round(t.prot) + '</span></div>'
      + '<div class="highlight"><span class="h-label">Remaining</span><span class="h-val">' + Math.round(pNeed) + ' g</span></div>'
      + '<div class="highlight"><span class="h-label">% of target</span><span class="h-val">' + protPct + '%</span></div>'
      + '</div>'
      + protStatus
      + '<div class="metric"><span class="label">Carbs</span><span>' + Math.round(d.carbs) + ' / ' + Math.round(t.carbs) + ' g (' + carbPct + '%)</span></div>'
      + '<div class="metric"><span class="label">Fat</span><span>' + Math.round(d.fat) + ' / ' + Math.round(t.fat) + ' g (' + fatPct + '%)</span></div>'
      + '<div class="metric"><span class="label">Workout</span><span>' + esc(workoutTxt) + '</span></div>'
      + '<div class="tip">' + esc(tip) + '</div>'
      + '</div>';
  }
  function renderToday() {
    var today = todayStr();
    var board = $('dashboard');
    board.className = 'dashboard' + (people.length > 1 ? ' cols' : '') + (people.length > 2 ? ' cols-3' : '');
    board.innerHTML = people.map(function (p, i) { return renderPersonCard(p, i, today); }).join('');
    var note = $('targetNote');
    if (note) note.textContent = targetNoteText();
    drawTrend();
  }
  function drawTrend() {
    var canvas = $('trendChart');
    var legend = $('trendLegend');
    if (!canvas || !people.length) return;
    var ctx = canvas.getContext('2d');
    var w = Math.max(280, (canvas.parentElement ? canvas.parentElement.clientWidth : 320) - 8);
    var h = 150;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var today = new Date();
    var days = [];
    for (var i = 6; i >= 0; i--) days.push(ymd(addDays(today, -i)));
    var maxCal = 0;
    people.forEach(function (p) {
      maxCal = Math.max(maxCal, (p.target && p.target.cal) || 0);
      days.forEach(function (ds) { maxCal = Math.max(maxCal, getDayData(p.name, ds).eaten); });
    });
    maxCal = Math.max(500, maxCal * 1.15);
    people.forEach(function (p, pi) {
      ctx.beginPath();
      ctx.strokeStyle = COLORS[pi % COLORS.length];
      ctx.lineWidth = 2.5;
      days.forEach(function (ds, n) {
        var data = getDayData(p.name, ds);
        var x = 28 + (n / 6) * (w - 44);
        var y = h - 22 - Math.min(data.eaten / maxCal, 1) * (h - 36);
        if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      days.forEach(function (ds, n) {
        var data = getDayData(p.name, ds);
        var x = 28 + (n / 6) * (w - 44);
        var y = h - 22 - Math.min(data.eaten / maxCal, 1) * (h - 36);
        ctx.fillStyle = COLORS[pi % COLORS.length];
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    });
    ctx.fillStyle = '#5f6368';
    ctx.font = '11px sans-serif';
    days.forEach(function (ds, n) {
      var x = 28 + (n / 6) * (w - 44);
      ctx.fillText(ds.slice(5), x - 14, h - 4);
    });
    if (legend) {
      legend.innerHTML = people.map(function (p, pi) {
        return '<span><i style="background:' + COLORS[pi % COLORS.length] + '"></i>' + esc(p.name) + '</span>';
      }).join('');
    }
  }
  function renderWeek() {
    var today = new Date();
    var html = '<table><tr><th>Date</th>';
    people.forEach(function (p) { html += '<th>' + esc(p.name) + '</th>'; });
    html += '</tr>';
    for (var i = 6; i >= 0; i--) {
      var ds = ymd(addDays(today, -i));
      html += '<tr><td>' + ds.slice(5) + '</td>';
      people.forEach(function (p) {
        var data = getDayData(p.name, ds);
        var targetCal = p.target && p.target.cal > 0 ? p.target.cal : 0;
        var st = dayStatus(data.eaten, targetCal, ds);
        html += '<td class="' + st + '">' + (data.eaten ? Math.round(data.eaten) : '') + '</td>';
      });
      html += '</tr>';
    }
    html += '</table>';
    $('weekResult').innerHTML = html;
  }
  function renderMonth(ym) {
    if (!ym || !people.length) return;
    var parts = ym.split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var days = new Date(y, m, 0).getDate();
    var counts = people.map(function () { return { ok: 0, low: 0, over: 0 }; });
    var html = '<table><tr><th>Date</th>';
    people.forEach(function (p) { html += '<th>' + esc(p.name) + '</th>'; });
    html += '</tr>';
    for (var d = 1; d <= days; d++) {
      var ds = ym + '-' + String(d).padStart(2, '0');
      html += '<tr><td>' + d + '</td>';
      people.forEach(function (p, pi) {
        var data = getDayData(p.name, ds);
        var targetCal = p.target && p.target.cal > 0 ? p.target.cal : 0;
        var st = dayStatus(data.eaten, targetCal, ds);
        if (st === 'ok') counts[pi].ok++;
        if (st === 'low') counts[pi].low++;
        if (st === 'over') counts[pi].over++;
        html += '<td class="' + st + '">' + (data.eaten ? Math.round(data.eaten) : '') + '</td>';
      });
      html += '</tr>';
    }
    html += '</table><p class="hint">';
    people.forEach(function (p, i) {
      html += esc(p.name) + ': ' + counts[i].ok + ' on track, ' + counts[i].low + ' low, ' + counts[i].over + ' over. ';
    });
    html += '</p>';
    $('monthResult').innerHTML = html;
  }
  function doSearch() {
    var q = $('searchInput').value.toLowerCase();
    var el = $('searchResult');
    if (!q) { el.innerHTML = ''; return; }
    var hits = allRows.filter(function (r) {
      var food = String(idx.food >= 0 ? r[idx.food] || '' : '').toLowerCase();
      var person = String(idx.person >= 0 ? r[idx.person] || '' : '').toLowerCase();
      return food.indexOf(q) >= 0 || person.indexOf(q) >= 0;
    }).slice(0, 40);
    if (!hits.length) { el.textContent = 'No matches'; return; }
    var html = '<table><tr><th>Date</th>' + (idx.person >= 0 ? '<th>Person</th>' : '') + '<th>Item</th><th>kcal</th></tr>';
    hits.forEach(function (r) {
      html += '<tr><td>' + esc(String(r[idx.date] || '').slice(0, 10)) + '</td>';
      if (idx.person >= 0) html += '<td>' + esc(r[idx.person] || '') + '</td>';
      html += '<td>' + esc(idx.food >= 0 ? r[idx.food] || '' : '') + '</td><td>' + Math.round(num(r[idx.cal])) + '</td></tr>';
    });
    el.innerHTML = html + '</table>';
  }
  function showApp() {
    $('home').style.display = 'none';
    $('app').style.display = 'block';
    document.body.classList.add('in-app');
    var month = $('viewMonth');
    if (month && !month.value) month.value = todayStr().slice(0, 7);
    renderToday();
    renderWeek();
    if (month) renderMonth(month.value);
  }
  function exitToHome() {
    localStorage.removeItem(cfg.storageKey);
    sheetUrl = '';
    document.body.classList.remove('in-app');
    $('app').style.display = 'none';
    $('home').style.display = 'flex';
    $('sheetUrl').value = '';
    clearError();
    closeMenus();
  }
  function applyRows(rows) {
    var headers = rows[0].map(function (h) { return h.trim(); });
    allRows = rows.slice(1);
    idx = {
      date: headers.findIndex(function (h) { return /date/i.test(h); }),
      person: headers.findIndex(function (h) { return /person/i.test(h); }),
      food: headers.findIndex(function (h) { return /food|workout/i.test(h); }),
      cal: headers.findIndex(function (h) { return /calor/i.test(h); }),
      protein: headers.findIndex(function (h) { return /protein/i.test(h); }),
      carbs: headers.findIndex(function (h) { return /carb/i.test(h); }),
      fat: headers.findIndex(function (h) { return /\bfat\b/i.test(h); })
    };
  }
  function loadPreview() {
    clearError();
    idx = { date: 0, person: 2, food: 3, cal: 4, protein: 5, carbs: 6, fat: 7 };
    var today = todayStr();
    if (cfg.variant === 'family') {
      people = ['Dad', 'Mom', 'Kid'].map(function (n) {
        var d = defaultsAt(0);
        return { name: n, target: { cal: d.cal, prot: d.prot, carbs: d.carbs, fat: d.fat } };
      });
      allRows = [
        [today, '08:00', 'Dad', 'Eggs', 420, 28, 20, 16],
        [today, '08:00', 'Mom', 'Yogurt', 310, 18, 40, 8],
        [today, '12:00', 'Kid', 'Sandwich', 480, 22, 50, 18]
      ];
    } else if (cfg.variant === 'solo') {
      var d0 = defaultsAt(0);
      people = [{ name: 'Me', target: { cal: d0.cal, prot: d0.prot, carbs: d0.carbs, fat: d0.fat } }];
      allRows = [
        [today, '08:30', 'Me', 'Eggs and toast', 420, 28, 35, 16],
        [today, '12:30', 'Me', 'Chicken rice', 680, 45, 70, 18]
      ];
    } else {
      people = [0, 1].map(function (i) {
        var ref = i === 0
          ? { cal: 2500, prot: 94, carbs: 344, fat: 83 }
          : { cal: 2000, prot: 75, carbs: 275, fat: 67 };
        return { name: i === 0 ? 'Husband' : 'Wife', target: ref };
      });
      allRows = [
        [today, '08:00', 'Husband', 'Breakfast', 520, 18, 70, 16],
        [today, '12:30', 'Husband', 'Lunch', 780, 32, 95, 24],
        [today, '08:00', 'Wife', 'Breakfast', 430, 16, 52, 14]
      ];
    }
    targetSource = 'demo';
    dropped = 0;
    showApp();
  }
  async function loadData() {
    var url = $('sheetUrl').value.trim();
    var id = extractId(url);
    clearError();
    if (!url) { showError('Paste a Google Sheets link first.'); return; }
    if (!id) { showError('That does not look like a Google Sheets link.'); return; }
    var btn = $('loadBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    var attempts = [
      sheetCsvUrl(id, 'Log'),
      'https://docs.google.com/spreadsheets/d/' + id + '/export?format=csv&gid=0&t=' + Date.now()
    ];
    var lastErr = '';
    try {
      for (var a = 0; a < attempts.length; a++) {
        try {
          var text = await fetchText(attempts[a]);
          var rows = parseCSV(text);
          if (rows.length < 2) { showError('The Log tab is empty.'); return; }
          applyRows(rows);
          if (idx.date < 0 || idx.cal < 0) { showError('The Log tab needs Date and Calories columns.'); return; }
          if (cfg.variant !== 'solo' && idx.person < 0) { showError('The Log tab needs a Person column.'); return; }
          var sheetTargets = [];
          try { sheetTargets = parseTargets(await fetchText(sheetCsvUrl(id, 'Dashboard'))); } catch (e) {}
          try {
            var ptext = await fetchText(sheetCsvUrl(id, 'Profile'));
            var prows = parseCSV(ptext);
            var fields = {};
            prows.forEach(function (r) { if (r[0]) fields[String(r[0]).trim()] = r.slice(1); });
            goals = {};
            var names = fields['Name'] || [];
            var gs = fields['Goal'] || [];
            names.forEach(function (n, i) { if (n) goals[String(n).trim().toLowerCase()] = gs[i] || ''; });
          } catch (e) {}
          var names = logNamesFromRows();
          if (cfg.variant !== 'solo' && !names.length) { showError('No names in the Person column yet.'); return; }
          assignPeople(names, sheetTargets);
          if (!people.length) { showError('No one to show yet.'); return; }
          sheetUrl = url;
          localStorage.setItem(cfg.storageKey, url);
          saveHistory(url);
          showApp();
          checkMeds(id);
          return;
        } catch (e) {
          lastErr = e && e.message ? e.message : '';
          if (e && e.name === 'TypeError') {
            showError('Cannot reach the sheet. Share it as anyone with the link can view.');
            return;
          }
        }
      }
      showError(lastErr ? 'Could not read the sheet (' + lastErr + ').' : 'Could not read the sheet.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Load Dashboard'; }
    }
  }
  async function refreshData() {
    var url = currentUrl();
    if (!extractId(url)) { loadPreview(); return; }
    $('sheetUrl').value = url;
    await loadData();
  }
  function showToast(msg) {
    var el = $('copyToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'copyToast';
      el.className = 'copy-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { el.hidden = true; }, 4500);
  }
  function onPhone() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function openAi(which, useMed) {
    closeMenus();
    var prompt = useMed && pendingMedPrompt ? pendingMedPrompt : instructionText();
    var shortPrompt = useMed && pendingMedPrompt
      ? pendingMedPrompt
      : 'Help me log food and workouts to my Google Sheet.\n\nMy sheet link: ' + (currentUrl() || '[paste your sheet link]') + '\n\nRead the README tab first, then the Profile tab. Follow those rules exactly.';
    var q = encodeURIComponent(shortPrompt);
    var names = { chatgpt: 'ChatGPT', grok: 'Grok', gemini: 'Gemini', claude: 'Claude' };
    var web = {
      chatgpt: 'https://chatgpt.com/?q=' + q,
      grok: 'https://grok.com/?q=' + q,
      gemini: 'https://gemini.google.com/app?q=' + q,
      claude: 'https://claude.ai/new?q=' + q
    };
    var app = {
      chatgpt: 'chatgpt://?q=' + q,
      grok: 'grok://?q=' + q,
      gemini: 'googlegemini://?q=' + q,
      claude: 'claude://claude.ai/new?q=' + q
    };
    var label = names[which] || 'the app';
    if (!onPhone()) {
      try { navigator.clipboard.writeText(prompt); } catch (e) {}
      window.open(web[which] || web.chatgpt, '_blank');
      return;
    }
    var went = false;
    function leave() {
      if (went) return;
      went = true;
      var left = false;
      function mark() { left = true; }
      window.addEventListener('pagehide', mark);
      function onVis() { if (document.hidden) mark(); }
      document.addEventListener('visibilitychange', onVis);
      window.location.href = app[which] || web[which];
      setTimeout(function () {
        window.removeEventListener('pagehide', mark);
        document.removeEventListener('visibilitychange', onVis);
        if (left) return;
        showToast('Copied. Paste it into ' + label + '.');
        window.open(web[which] || web.chatgpt, '_blank');
      }, 1400);
    }
    try {
      var pending = navigator.clipboard.writeText(prompt);
      if (pending && pending.then) pending.then(leave, leave);
      else leave();
    } catch (e) {
      leave();
    }
    setTimeout(leave, 500);
  }
  function medKey() { return 'medAsked_' + cfg.storageKey + '_' + todayStr(); }
  function resetMedModal() {
    pendingMedPrompt = '';
    var actions = $('medActions');
    var ai = $('medAi');
    if (actions) actions.hidden = false;
    if (ai) ai.hidden = true;
  }
  function closeMed() { $('medModal').classList.remove('show'); }
  async function checkMeds(id) {
    try {
      var text = await fetchText(sheetCsvUrl(id, 'Profile'));
      var rows = parseCSV(text);
      var fields = {};
      rows.forEach(function (r) { if (r[0]) fields[String(r[0]).trim()] = r.slice(1); });
      medPeople = [];
      var has = fields['Has scheduled meds'] || [];
      has.forEach(function (v, i) {
        if (/^yes$/i.test(String(v || '').trim())) {
          medPeople.push({
            name: (fields['Name'] || [])[i] || ('Person ' + (i + 1)),
            med: (fields['Medication 1 name'] || [])[i] || 'medication'
          });
        }
      });
      if (!medPeople.length) return;
      if (localStorage.getItem(medKey())) return;
      if (sessionStorage.getItem(medKey() + '_snooze')) return;
      resetMedModal();
      $('medText').textContent = medPeople.map(function (p) { return p.name; }).join(', ') + ' — have you taken your medication today?';
      $('medModal').classList.add('show');
    } catch (e) {}
  }
  async function medAnswer(taken) {
    if (!taken) {
      sessionStorage.setItem(medKey() + '_snooze', '1');
      closeMed();
      return;
    }
    localStorage.setItem(medKey(), 'yes');
    var who = medPeople.map(function (p) { return p.name + ' ' + p.med; }).join(', ');
    var verb = cfg.variant === 'solo' ? 'I took my medication today. ' : 'We took our medication today. ';
    pendingMedPrompt = verb + who + '\n\nMy sheet link: ' + currentUrl() + '\n\nAppend a row to the Medications tab. Do not say it is logged until that row is added.';
    try { await navigator.clipboard.writeText(pendingMedPrompt); } catch (e) {}
    $('medText').textContent = 'Copied a note for your AI. The sheet is not updated until the AI adds the row.';
    $('medActions').hidden = true;
    $('medAi').hidden = false;
  }
  function skipMed() {
    localStorage.setItem(medKey(), 'skip');
    closeMed();
  }
  function showPanel(name, btn) {
    document.querySelectorAll('.panel').forEach(function (p) { p.style.display = 'none'; });
    $('panel-' + name).style.display = 'block';
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }

  $('loadBtn').addEventListener('click', loadData);
  $('previewBtn').addEventListener('click', loadPreview);
  $('refreshBtn').addEventListener('click', refreshData);
  document.querySelectorAll('[data-action="howto"]').forEach(function (b) {
    b.addEventListener('click', openHowto);
  });
  document.querySelectorAll('[data-action="switch"]').forEach(function (b) {
    b.addEventListener('click', exitToHome);
  });
  $('howtoClose').addEventListener('click', function () { $('howtoModal').classList.remove('open'); });
  $('howtoModal').addEventListener('click', function (e) { if (e.target === $('howtoModal')) $('howtoModal').classList.remove('open'); });
  $('copyInstruction').addEventListener('click', function () {
    var btn = $('copyInstruction');
    navigator.clipboard.writeText(instructionText()).then(function () { btn.textContent = 'Copied'; });
  });
  $('askBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    var m = $('aiMenu');
    m.style.display = m.style.display === 'block' ? 'none' : 'block';
  });
  document.querySelectorAll('#aiMenu [data-ai], #medAi [data-ai]').forEach(function (b) {
    b.addEventListener('click', function () { openAi(b.dataset.ai, b.hasAttribute('data-med')); });
  });
  $('sheetUrl').addEventListener('focus', function () { renderHistory(getHistory()); });
  $('sheetUrl').addEventListener('input', function () {
    var q = $('sheetUrl').value.toLowerCase();
    renderHistory(getHistory().filter(function (u) { return u.toLowerCase().indexOf(q) >= 0; }));
  });
  $('sheetUrl').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadData(); });
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showPanel(b.dataset.panel, b); });
  });
  $('viewMonth').addEventListener('change', function () { renderMonth($('viewMonth').value); });
  $('searchInput').addEventListener('input', doSearch);
  $('medYes').addEventListener('click', function () { medAnswer(true); });
  $('medNo').addEventListener('click', function () { medAnswer(false); });
  $('medSkip').addEventListener('click', skipMed);
  document.addEventListener('click', function (e) {
    var hist = $('linkHistory');
    if (hist && !e.target.closest('.input-wrap')) hist.style.display = 'none';
    if (!e.target.closest('.ask-wrap')) {
      var menu = $('aiMenu');
      if (menu) menu.style.display = 'none';
    }
  });
  window.addEventListener('resize', function () { if (document.body.classList.contains('in-app')) drawTrend(); });

  var saved = localStorage.getItem(cfg.storageKey);
  if (saved) {
    $('sheetUrl').value = saved;
    loadData();
  }
})();
