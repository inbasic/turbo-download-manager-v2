'use strict';

document.getElementById('rename').addEventListener('click', () => {
  const pattern = document.getElementById('pattern').value || 'name-[#].[ext]';
  const re = /#=(\d+)/.exec(pattern);
  const offset = re && re.length ? Number(re[1]) : 1;
  const inputs = [...document.querySelectorAll('#list input:checked')]
    .map(i => i.closest('div').querySelector('input[name=filename]'));

  const length = String(inputs.length).length + 1;
  const zeros = Array.from({
    length
  }, () => '0').join('');

  inputs.forEach((i, index) => {
    const n = (zeros + (index + offset)).substr(-1 * length);
    const ext = i.value.indexOf('.') === -1 ? '' : i.value.split('.').pop();
    i.value = pattern
      .replace('[ext]', ext)
      .replace(/\[#=*\d*\]/, n)
      .replace(/\.$/, '');
  });
});
