import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Page, Header, Content, ContentHeader, Progress, ErrorPanel } from '@backstage/core-components';
import { Select, MenuItem, FormControl, InputLabel, Box } from '@material-ui/core';
import { vsm, VsmChart } from '../../engine';

/* The whole integration is the useEffect below. The chart is a plain DOM
 * object, so React owns the container and nothing else: mount on first render,
 * update when a control changes, destroy on unmount. No React state lives
 * inside the chart and no chart state leaks into React. */
export const ValueStreamPage = () => {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<VsmChart | null>(null);
  const [profile, setProfile] = useState('build-paved');
  const [view, setView] = useState('current');
  const [profiles, setProfiles] = useState<Array<{ id: string; label: string }>>([]);
  const [stat, setStat] = useState('');
  const [error, setError] = useState<Error | null>(null);

  const refreshStat = useCallback(() => {
    const a = chartRef.current?.analyze();
    if (a) setStat(`${a.tasks} tasks · ${a.pathDays} d critical path · parallelism ${a.parallelism}x`);
  }, []);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    try {
      chartRef.current = vsm.embed.create(hostRef.current, { profile, view, theme: 'dark' });
      setProfiles(chartRef.current.getScenarioOptions().profiles);
      refreshStat();
    } catch (e) {
      setError(e as Error);          // invalid data is reported, never an empty box
    }
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.update({ profile, view });
    refreshStat();
  }, [profile, view, refreshStat]);

  if (error) return <ErrorPanel error={error} />;

  return (
    <Page themeId="tool">
      <Header title="Value Stream" subtitle={stat} />
      <Content>
        <ContentHeader title="">
          <Box display="flex" gridGap={12}>
            <FormControl variant="outlined" size="small" style={{ minWidth: 260 }}>
              <InputLabel>Scenario</InputLabel>
              <Select label="Scenario" value={profile} onChange={e => setProfile(e.target.value as string)}>
                {profiles.map(p => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl variant="outlined" size="small" style={{ minWidth: 180 }}>
              <InputLabel>View</InputLabel>
              <Select label="View" value={view} onChange={e => setView(e.target.value as string)}>
                <MenuItem value="current">Current</MenuItem>
                <MenuItem value="opportunity">Opportunity</MenuItem>
                <MenuItem value="waste">Waste / Friction</MenuItem>
                <MenuItem value="optimal">Optimal</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </ContentHeader>
        {!profiles.length && !error && <Progress />}
        <div ref={hostRef} />
      </Content>
    </Page>
  );
};
