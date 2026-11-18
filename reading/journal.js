(function (root) {
  'use strict';
  const MAX_ENTRIES = 20;
  let connection;

  function database() {
    if (!connection) {
      connection = new Promise((resolve, reject) => {
        const request = indexedDB.open('paper-onestep-reading', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('papers');
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            connection = null;
          };
          resolve(request.result);
        };
        request.onerror = () => reject(new Error('readerJournalFailed'));
      }).catch(error => {
        connection = null;
        throw error;
      });
    }
    return connection;
  }

  function emptyJournal() {
    return { notes: '', entries: [] };
  }

  async function access(key, update) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('papers', update ? 'readwrite' : 'readonly');
      const store = tx.objectStore('papers');
      const request = store.get(key);
      let journal;
      let failure;
      request.onsuccess = () => {
        try {
          journal = request.result || emptyJournal();
          if (update) {
            update(journal);
            if (journal.notes || journal.entries.length) store.put(journal, key);
            else store.delete(key);
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(journal);
      tx.onabort = () => reject(failure || new Error('readerJournalFailed'));
    });
  }

  function evidence(report) {
    const cited = new Set(report.analysis.sections.flatMap(section => section.sources));
    const sources = report.context.sources.filter(source => cited.has(source.id));
    return { ...report, context: { ...report.context, sources,
      omitted: report.context.omitted + report.context.sources.length - sources.length,
      characters: sources.reduce((count, source) => count + source.text.length, 0) } };
  }

  root.PaperReadingJournal = {
    load: key => access(key),
    saveNotes: (key, notes) => access(key, journal => { journal.notes = notes.slice(0, 12000); }),
    pin: (key, report) => access(key, journal => {
      const index = journal.entries.findIndex(entry => entry.id === report.id);
      if (index >= 0) journal.entries[index] = evidence(report);
      else {
        if (journal.entries.length >= MAX_ENTRIES) throw new Error('readerJournalFull');
        journal.entries.unshift(evidence(report));
      }
    }),
    remove: (key, id) => access(key, journal => { journal.entries = journal.entries.filter(entry => entry.id !== id); })
  };
})(globalThis);
