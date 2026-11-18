(function (root) {
  'use strict';
  const R = root.PaperReading;
  const $ = id => document.getElementById(id);
  const t = key => chrome.i18n.getMessage(key) || key;

  function updateEnabled() {
    for (const id of ['readingEndpoint', 'readingModel', 'readingApiKey', 'readingLanguage']) $(id).disabled = !$('readingEnabled').checked;
  }

  function read() {
    return R.normalizeConfig({ enabled: $('readingEnabled').checked, endpoint: $('readingEndpoint').value,
      model: $('readingModel').value, apiKey: $('readingApiKey').value, language: $('readingLanguage').value });
  }

  function authorize(config) {
    return config.enabled ? chrome.permissions.request({ origins: [R.endpointInfo(config.endpoint).origin] }) : Promise.resolve(true);
  }

  $('readingEnabled').addEventListener('change', updateEnabled);
  $('readingClearCache').addEventListener('click', async () => {
    try { await chrome.storage.local.remove('readingCache'); $('readingSettingsStatus').textContent = t('readerCacheCleared'); }
    catch { $('readingSettingsStatus').textContent = t('readerStorageFailed'); }
  });
  chrome.storage.local.get('readingConfig').then(result => {
    const config = { ...R.DEFAULT_CONFIG, ...result.readingConfig };
    $('readingEnabled').checked = config.enabled === true;
    $('readingEndpoint').value = config.endpoint || '';
    $('readingModel').value = config.model || '';
    $('readingApiKey').value = config.apiKey || '';
    $('readingLanguage').value = config.language || 'auto';
    updateEnabled();
  }).catch(() => { $('readingSettingsStatus').textContent = t('readerStorageFailed'); });
  root.PaperReadingSettings = { read, authorize };
})(globalThis);
