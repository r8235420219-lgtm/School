// admin.js — teacher dashboard with Chart.js time-series and per-student table.
import { api, state, $, toast } from './api.js';

let chart = null;
let currentPeriod = 'day';

window.addEventListener('DOMContentLoaded', async () => {
  wireLogout();
  wirePeriodToggle();
  try {
    const { user } = await api.me();
    state.user = user;
    if (user.role !== 'admin') { location.href = '/'; return; }
    await Promise.all([loadOverview(), loadCharts()]);
  } catch (err) {
    toast(err.message || 'Could not load dashboard.');
    setTimeout(() => { location.href = '/'; }, 2000);
  }
});

function wireLogout() {
  $('#logout-btn').addEventListener('click', async () => {
    try { await api.logout(); } catch {}
    location.href = '/';
  });
}

function wirePeriodToggle() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('is-active'));
      t.classList.add('is-active');
      currentPeriod = t.dataset.period;
      loadCharts();
    });
  });
}

// ── Per-student overview table ──
async function loadOverview() {
  try {
    const { students } = await fetch('/api/admin/overview', { credentials: 'same-origin' })
      .then((r) => r.json());
    const table = $('#student-table');
    const empty = $('#table-empty');
    if (!students.length) { empty.hidden = false; return; }
    empty.hidden = true;
    table.innerHTML = students.map((s) => {
      const mins = Math.floor(s.totalSeconds / 60);
      const pct = s.totalAssets > 0 ? Math.round((s.completed / s.totalAssets) * 100) : 0;
      return `
        <div class="node-card" style="flex-direction: column; align-items: flex-start; gap: 8px;">
          <div style="display: flex; width: 100%; align-items: center; gap: 10px;">
            <div class="node-ico" style="font-size: 18px;">👤</div>
            <div class="node-body" style="flex: 1;">
              <div class="node-name">${esc(s.name)}</div>
              <div class="node-meta">${mins} min reading · ${s.completed} completed · ${pct}% done</div>
            </div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    toast(err.message || 'Could not load students.');
  }
}

// ── Chart.js time-series ──
async function loadCharts() {
  try {
    const { period, series } = await fetch(`/api/admin/charts?period=${currentPeriod}`, {
      credentials: 'same-origin',
    }).then((r) => r.json());

    const labels = series.map((s) => s.label);
    const activeData = series.map((s) => s.activeStudents);
    const secondsData = series.map((s) => Math.round(s.totalSeconds / 60)); // convert to minutes

    if (!chart) {
      const ctx = $('#chart').getContext('2d');
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Active students',
              data: activeData,
              borderColor: '#6366f1',
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              tension: 0.3,
              yAxisID: 'y1',
            },
            {
              label: 'Total reading (min)',
              data: secondsData,
              borderColor: '#22d3ee',
              backgroundColor: 'rgba(34, 211, 238, 0.2)',
              tension: 0.3,
              yAxisID: 'y2',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#eef1ff', font: { size: 13 } } },
            tooltip: {
              backgroundColor: 'rgba(24, 28, 47, 0.95)',
              titleColor: '#eef1ff',
              bodyColor: '#eef1ff',
              borderColor: '#333a5c',
              borderWidth: 1,
            },
          },
          scales: {
            x: { ticks: { color: '#9aa2c9', font: { size: 11 } }, grid: { color: '#333a5c' } },
            y1: {
              type: 'linear',
              position: 'left',
              ticks: { color: '#6366f1', font: { size: 11 }, stepSize: 1 },
              grid: { color: '#333a5c' },
              title: { display: true, text: 'Students', color: '#6366f1' },
            },
            y2: {
              type: 'linear',
              position: 'right',
              ticks: { color: '#22d3ee', font: { size: 11 } },
              grid: { display: false },
              title: { display: true, text: 'Minutes', color: '#22d3ee' },
            },
          },
        },
      });
    } else {
      chart.data.labels = labels;
      chart.data.datasets[0].data = activeData;
      chart.data.datasets[1].data = secondsData;
      chart.update();
    }
  } catch (err) {
    toast(err.message || 'Could not load charts.');
  }
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
