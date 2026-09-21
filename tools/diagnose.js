const V = require('../js/node.js');
const r1 = v => Math.round(v * 10) / 10;

(async () => {
  const file = process.env.IMPORT_FILE || require('path').join(__dirname, '..', 'fixture', 'sample-value-stream.xlsx');
  const res = await V.import.fromWorkbook(V.readWorkbook(file));
  const perDay = res.process.hoursPerDay || 8;
  const full = res.scenario.presets.find(p => p.id === 'full-scope');
  const sc = Object.assign(V.rules.defaults(res.scenario.attributes), full ? full.set : {});
  const build = proc => V.schedule.build(proc, res.taxonomy, sc, res.scenario.rules, res.scenario.attributes);

  const m = build(res.process);
  const p = V.analyze.profile(m, { hoursPerDay: perDay });

  console.log('=== WHERE THE TIME GOES ===');
  console.log(`tasks ${p.tasks}   summed work ${p.summedDays} d   critical path ${p.pathDays} d   parallelism ${p.parallelism}x`);
  console.log(`the chain is ${p.chainSteps} steps long, ${p.chainGates} of them approval gates`);
  console.log(`on the chain: ${p.chainLeadDays} d waiting + ${p.chainCycleDays} d working = flow efficiency ${p.chainFlowEfficiency}%`);
  console.log('\ncritical path by phase:');
  p.byPhase.slice(0, 8).forEach(x => console.log(`  ${String(x.label).slice(0,40).padEnd(42)} ${String(x.steps).padStart(3)} steps ${String(x.days).padStart(7)} d  ${x.gates} gates`));
  console.log('\nlongest single steps on the chain:');
  p.longest.slice(0, 8).forEach(x => console.log(`  ${x.days.toFixed(1).padStart(6)} d  ${x.gate ? 'GATE ' : '     '}${x.name.slice(0,38).padEnd(40)} ${x.team.slice(0,26)}`));

  // ---- is the workbook's lead time in business hours or calendar hours? ----
  const uc = V.analyze.unitCheck(res.process, perDay);
  console.log('\n=== ARE THE UNITS WHAT WE THINK ===');
  if (uc.rows) {
    console.log(`  ${uc.rows} steps have a wait:  ${uc.pctWorkingHoursOnly}% working-hour values, ${uc.pctCalendarWeeks}% calendar weeks, ${uc.pctAmbiguous}% ambiguous, ${uc.pctOffAnyGrid}% on no round grid.`);
    console.log('  verdict: ' + uc.verdict);
    if (uc.offAnyGrid) {
      console.log(`  ${uc.offAnyGrid} value(s) sit on no round grid, e.g.`);
      uc.examplesOffGrid.slice(0, 4).forEach(x => console.log(`    ${String(x.hours).padStart(7)} h  ${x.name.slice(0, 44)}`));
    }
    console.log('\n  the ten longest waits, read both ways:');
    console.log('      ' + 'hours'.padStart(7) + 'work d'.padStart(8) + 'cal d'.padStart(7) + '  if calendar hrs   step');
    uc.biggestWaits.forEach(x => console.log('      ' + String(x.hours).padStart(7) +
      String(x.workingDays).padStart(8) + String(x.calendarDaysIfWorkHours).padStart(7) +
      String(x.calendarDaysIf24 + ' d').padStart(17) + '   ' + x.name.slice(0, 32)));
  } else console.log('  ' + uc.verdict);

  console.log('\n=== WHAT WOULD MOVE IT ===');
  const basePath = p.pathDays;
  const show = (label, proc) => {
    const q = V.analyze.profile(build(proc), { hoursPerDay: perDay });
    const d = q.pathDays - basePath;
    console.log(`  ${label.padEnd(52)} ${String(q.pathDays).padStart(7)} d   ${(d >= 0 ? '+' : '') + r1(d)} d   ${r1(100 * d / basePath)}%`);
  };
  console.log(`  ${'baseline'.padEnd(52)} ${String(basePath).padStart(7)} d`);
  [0.75, 0.5].forEach(f => show(`every wait is ${Math.round((1-f)*100)}% shorter than estimated`, V.analyze.scaleLead(res.process, f)));
  [20, 10, 5].forEach(d => show(`no single step waits more than ${d} days`, V.analyze.capWait(res.process, d, perDay)));
  show('shared queues counted once per team, not per step',
    V.analyze.mergeQueues(res.process, a => a.category === 'gate' ? 'gate:' + a.owner : null));
})();
