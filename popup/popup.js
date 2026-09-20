// Popup Settings Logic
document.addEventListener('DOMContentLoaded', async () => {
  const speedSelect = document.getElementById('defaultSpeed');

  // Load saved default speed
  const { defaultSpeed } = await chrome.storage.local.get('defaultSpeed');
  if (defaultSpeed) {
    speedSelect.value = String(defaultSpeed);
  }

  // Save new default speed
  speedSelect.addEventListener('change', async (e) => {
    const newSpeed = parseFloat(e.target.value) || 1.0;
    await chrome.storage.local.set({ defaultSpeed: newSpeed });
  });
});
