(() => {
  const main=document.createElement('script');
  main.src='/quick-choice-v3.js?build=qc-v5';
  document.body.appendChild(main);

  const labels=document.createElement('script');
  labels.src='/quick-choice-genre-labels-v1.js?build=qc-v5';
  document.body.appendChild(labels);
})();
