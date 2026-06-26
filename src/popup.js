(function () {
  'use strict';

  var statusEl = document.getElementById('status');
  var listEl = document.getElementById('list');
  var topActions = document.getElementById('topActions');
  var pageTypeEl = document.getElementById('pageType');
  var btnZip = document.getElementById('btnZip');
  var btnAll = document.getElementById('btnAll');

  var currentImages = [];
  var currentPageName = 'dreem';

  var TYPE_LABEL = { character: '角色页', location: '场景页', unknown: '非目标页' };

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (isError ? ' error' : '');
    statusEl.hidden = !text;
  }

  function sendToBackground(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, function (resp) { resolve(resp); });
    });
  }

  function renderList(images) {
    listEl.innerHTML = '';
    images.forEach(function (img, idx) {
      var li = document.createElement('li');
      li.className = 'item';

      var thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.src = img.url;
      thumb.alt = img.label;
      thumb.onerror = function () { thumb.style.visibility = 'hidden'; };

      var meta = document.createElement('div');
      meta.className = 'meta';
      var dim = (img.width && img.height) ? (img.width + '×' + img.height) : '';
      meta.innerHTML = '<div class="label"></div><div class="dim"></div>';
      meta.querySelector('.label').textContent = img.label;
      meta.querySelector('.dim').textContent = dim;

      var btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = '下载';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        sendToBackground({ type: 'download', images: [img] }).then(function () {
          btn.textContent = '已下载';
        });
      });

      li.appendChild(thumb);
      li.appendChild(meta);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  function init() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab) { setStatus('无法获取当前标签页', true); return; }

      chrome.tabs.sendMessage(tab.id, { type: 'scan' }, function (resp) {
        if (chrome.runtime.lastError || !resp) {
          pageTypeEl.textContent = '非目标页';
          setStatus('请在 dreem-world 的角色或场景页面打开本扩展。', true);
          return;
        }
        pageTypeEl.textContent = TYPE_LABEL[resp.pageType] || '非目标页';

        if (!resp.ok) {
          setStatus('请在角色或场景页面打开本扩展。', true);
          return;
        }

        currentImages = resp.images || [];
        currentPageName = resp.pageName || 'dreem';

        if (currentImages.length === 0) {
          setStatus('未找到图片，页面结构可能已变更（可打开控制台查看 [Dreem下载] 日志）。', true);
          return;
        }

        setStatus('', false);
        topActions.hidden = false;
        renderList(currentImages);
      });
    });
  }

  btnAll.addEventListener('click', function () {
    if (!currentImages.length) return;
    btnAll.disabled = true;
    sendToBackground({ type: 'download', images: currentImages }).then(function () {
      btnAll.textContent = '已全部下载';
      btnAll.disabled = false;
    });
  });

  btnZip.addEventListener('click', function () {
    if (!currentImages.length) return;
    btnZip.disabled = true;
    var orig = btnZip.textContent;
    btnZip.textContent = '打包中…';
    sendToBackground({ type: 'zip', images: currentImages, zipName: currentPageName }).then(function (r) {
      btnZip.textContent = (r && r.failures && r.failures.length) ? ('完成（' + r.failures.length + ' 张失败）') : '已打包';
      btnZip.disabled = false;
      setTimeout(function () { btnZip.textContent = orig; }, 2500);
    });
  });

  init();
})();
