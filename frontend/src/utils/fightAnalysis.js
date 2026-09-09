const INITIAL_WINDOW = 20;
const KILL_EXTENSION = 10;

function checkIsTeam1(teamName, t1Name) {
    if (!teamName) return false;
    if (teamName === t1Name) return true;
    return teamName === '1팀' || teamName === 'Team 1';
}

function checkIsTeam2(teamName, t2Name) {
    if (!teamName) return false;
    if (teamName === t2Name) return true;
    return teamName === '2팀' || teamName === 'Team 2';
}

/**
 * 이벤트 배열에서 한타(fight)를 분리하고 승패를 판정한다.
 *
 * @param {Array<{event_type:string, timestamp:number, player_team:string, target_team:string, target_name:string, target_hero:string}>} events
 *   - kill / ultimate_start 이벤트를 포함한 배열 (다른 타입은 무시됨)
 * @param {string} t1Name - 팀1 이름
 * @param {string} t2Name - 팀2 이름
 * @returns {Array<{
 *   startTime: number,
 *   fixedEndTime: number,
 *   events: Array,
 *   t1Kills: number,
 *   t2Kills: number,
 *   team1_deaths: number,
 *   team2_deaths: number,
 *   first_pick_team: string|null,
 *   first_pick_player: string|null,
 *   first_pick_hero: string|null,
 *   first_pick_event: object|null,
 *   duration_sec: number,
 *   winner: string
 * }>} fights
 */
export function computeFights(events, t1Name, t2Name) {
    const fights = [];
    let curF = null;

    [...events].sort((a, b) => a.timestamp - b.timestamp).forEach(ev => {
        if (ev.event_type !== 'kill' && ev.event_type !== 'ultimate_start') return;

        if (!curF || ev.timestamp > curF.fixedEndTime) {
            if (curF) {
                curF.duration_sec = curF.events[curF.events.length - 1].timestamp - curF.events[0].timestamp;
                fights.push(curF);
            }
            curF = {
                startTime: ev.timestamp,
                fixedEndTime: ev.timestamp + INITIAL_WINDOW,
                events: [ev],
                t1Kills: 0, t2Kills: 0,
                team1_deaths: 0, team2_deaths: 0,
                first_pick_team: null,
                first_pick_player: null,
                first_pick_hero: null,
                first_pick_event: null
            };
        } else {
            curF.events.push(ev);
        }

        if (ev.event_type === 'kill') {
            if (!curF.first_pick_team) {
                curF.first_pick_team = ev.target_team;
                curF.first_pick_player = ev.target_name;
                curF.first_pick_hero = ev.target_hero;
                curF.first_pick_event = ev;
            }

            if (checkIsTeam1(ev.player_team, t1Name)) curF.t1Kills++;
            else if (checkIsTeam2(ev.player_team, t2Name)) curF.t2Kills++;

            if (checkIsTeam1(ev.target_team, t1Name)) curF.team1_deaths++;
            else if (checkIsTeam2(ev.target_team, t2Name)) curF.team2_deaths++;

            // rolling window: kill 발생 시마다 윈도우 연장 (INITIAL_WINDOW=20보다 작아지지 않도록 Math.max)
            curF.fixedEndTime = Math.max(curF.fixedEndTime, ev.timestamp + KILL_EXTENSION);
        }
    });

    if (curF) {
        curF.duration_sec = curF.events[curF.events.length - 1].timestamp - curF.events[0].timestamp;
        fights.push(curF);
    }

    fights.forEach(f => {
        const t1Survivors = Math.max(0, 5 - f.team1_deaths);
        const t2Survivors = Math.max(0, 5 - f.team2_deaths);
        if (t1Survivors > t2Survivors) f.winner = t1Name;
        else if (t2Survivors > t1Survivors) f.winner = t2Name;
        else f.winner = 'Draw';
    });

    return fights;
}
