(() => {
  const main=document.createElement('script');
  main.src='/quick-choice-v3.js?build=qc-v6';
  document.body.appendChild(main);

  const labels=document.createElement('script');
  labels.src='/quick-choice-genre-labels-v1.js?build=qc-v6';
  document.body.appendChild(labels);

  const restart=document.createElement('script');
  restart.src='/quick-choice-restart-v1.js?build=qc-v6';
  document.body.appendChild(restart);
})();
