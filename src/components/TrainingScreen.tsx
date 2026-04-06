import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NeuroEngine, TrainingMetrics } from '../logic/NeuroEngine';
import './TrainingScreen.css';

type ScreenState = 'INTRO_1' | 'INTRO_2' | 'DASHBOARD' | 'IDLE' | 'COUNTDOWN' | 'GO' | 'STOP' | 'FINISHED';

interface SessionRecord {
    id: string;
    date: number;
    ssrt: number;
    accuracy: number;
    rank: string;
    rankColor: string;
    rtsd: number;
    feedback: string;
}

const METRIC_INFO = {
    SSRT: {
        title: "SSRT (Stop-Signal Reaction Time)",
        desc: "Es la velocidad a la que tu cerebro procesa una orden de frenado. En el deporte, es lo que te permite abortar un movimiento ante un amague o cambio repentino del rival. Menos tiempo = mejor agilidad mental."
    },
    ACC: {
        title: "PRECISIÓN (ACC)",
        desc: "Porcentaje de paradas exitosas. Indica tu capacidad de inhibición bajo presión. Un valor cercano al 65% significa que estás en tu zona óptima de dificultad (Zona de Esfuerzo Élite)."
    },
    RTSD: {
        title: "SST-RTSD (Variabilidad Neural)",
        desc: "Mide la consistencia de tu cerebro al reaccionar. Menor variabilidad indica un estado de 'Flow' y control mental estable. Valores altos pueden indicar fatiga o distracción."
    }
};

export const TrainingScreen: React.FC = () => {
    // Component State
    const [state, setState] = useState<ScreenState>('INTRO_1');
    const [metrics, setMetrics] = useState<TrainingMetrics>({
        ssrt: 0,
        accuracy: 0,
        currentSSD: 250,
        fatigueDetected: false,
        rtsd: 0
    });
    const [currentTrial, setCurrentTrial] = useState(0);
    const [countdown, setCountdown] = useState(3);
    const [history, setHistory] = useState<SessionRecord[]>([]);
    const [showSSRTInfo, setShowSSRTInfo] = useState(false);
    const [showACCInfo, setShowACCInfo] = useState(false);
    const [showRTSDInfo, setShowRTSDInfo] = useState(false);
    const [activeDashboardInfo, setActiveDashboardInfo] = useState<{id: string, type: keyof typeof METRIC_INFO} | null>(null);

    // Constants
    const MAX_TRIALS = 50;

    // Logic Refs
    const currentTrialRef = useRef(0);
    const ssdRef = useRef(250);
    const goRTsRef = useRef<number[]>([]);
    const stopOutcomesRef = useRef<boolean[]>([]);
    const stimulusStartTimeRef = useRef<number>(0);
    const trialTimeoutRef = useRef<any>(null);
    const ssdHistoryRef = useRef<number[]>([]);

    // Initial Load: Records
    useEffect(() => {
        const saved = localStorage.getItem('neuro_focus_history');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Migración de datos legados: Asegurar que rtsd y feedback existan
            const sanitized = parsed.map((r: any) => ({
                ...r,
                rtsd: r.rtsd ?? 0,
                feedback: r.feedback ?? "Registro de sesión anterior."
            }));
            setHistory(sanitized);
        }
    }, []);

    // Session Management
    const startTraining = () => {
        currentTrialRef.current = 0;
        setCurrentTrial(0);
        goRTsRef.current = [];
        stopOutcomesRef.current = [];
        ssdRef.current = 250;
        setMetrics({
            ssrt: 0,
            accuracy: 0,
            currentSSD: 250,
            fatigueDetected: false,
            rtsd: 0
        });
        ssdHistoryRef.current = [];
        setState('COUNTDOWN');
        let count = 3;
        const interval = setInterval(() => {
            count -= 1;
            setCountdown(count);
            if (count === 0) {
                clearInterval(interval);
                nextTrial();
            }
        }, 1000);
    };

    const nextTrial = useCallback(async () => {
        if (currentTrialRef.current >= MAX_TRIALS) {
            finishSession();
            return;
        }
        
        setState('IDLE');
        const isi = 800 + Math.random() * 700;
        await new Promise(resolve => setTimeout(resolve, isi));

        currentTrialRef.current += 1;
        setCurrentTrial(currentTrialRef.current);
        const isStopTrial = Math.random() < 0.30; 

        if (isStopTrial) {
            runStopTrial();
        } else {
            runGoTrial();
        }
    }, []);

    const runGoTrial = () => {
        stimulusStartTimeRef.current = performance.now();
        setState('GO');
        trialTimeoutRef.current = setTimeout(() => processGoResponse(null), 1000);
    };

    const runStopTrial = () => {
        stimulusStartTimeRef.current = performance.now();
        setState('GO');
        ssdHistoryRef.current.push(ssdRef.current);
        setTimeout(() => setState('STOP'), ssdRef.current);
        trialTimeoutRef.current = setTimeout(() => processStopOutcome(true), 1000);
    };

    const handleAction = () => {
        if (state === 'GO') {
            if (trialTimeoutRef.current) clearTimeout(trialTimeoutRef.current);
            const rt = performance.now() - stimulusStartTimeRef.current;
            processGoResponse(rt);
        } else if (state === 'STOP') {
            if (trialTimeoutRef.current) clearTimeout(trialTimeoutRef.current);
            processStopOutcome(false);
        }
    };

    const processGoResponse = (rt: number | null) => {
        if (rt) {
            if (rt < NeuroEngine.ANTICIPATION_THRESHOLD) {
                // Anticipación detectada: Ignorar ensayo para SSRT pero marcar fatiga si es persistente
                setMetrics(prev => ({ ...prev, fatigueDetected: true }));
            } else {
                goRTsRef.current.push(rt);
                if (NeuroEngine.checkCognitiveFatigue(rt, goRTsRef.current)) {
                    setMetrics(prev => ({ ...prev, fatigueDetected: true }));
                }
            }
        }
        nextTrial();
    };

    const processStopOutcome = (success: boolean) => {
        stopOutcomesRef.current.push(success);
        const outcomes = stopOutcomesRef.current;
        const nStop = outcomes.length;
        const nFail = outcomes.filter(x => !x).length;
        const pError = nFail / nStop;

        const successRate = 1 - pError;
        const nextSSD = NeuroEngine.calculateNextSSD(ssdRef.current, successRate);
        ssdRef.current = nextSSD;

        // SSRT robusto usando el promedio de SSDs de la sesión
        const meanSSD = ssdHistoryRef.current.reduce((a,b) => a+b, 0) / nStop;
        const ssrt = NeuroEngine.calculateSSRT(goRTsRef.current, pError, meanSSD);
        const rtsd = NeuroEngine.calculateRTSD(goRTsRef.current);

        setMetrics(prev => ({ ...prev, ssrt, accuracy: successRate, currentSSD: nextSSD, rtsd }));
        nextTrial();
    };

    const getFeedback = (ssrt: number, rtsd: number, fatigue: boolean) => {
        if (fatigue) return "FATIGA DETECTADA. Priorizar recuperación neural (Sueño/Hidratación) antes de una nueva sesión.";
        if (ssrt < 200) return "CONTROL ÉLITE. Tu inhibición es óptima. Mantener volumen de mantenimiento (2-3 sesiones/semana).";
        if (ssrt < 240) return "ALTO RENDIMIENTO. Enfocarse en la consistencia (bajar RTSD) para estabilizar el foco.";
        if (ssrt < 280) return "BASE COGNITIVA. Buen progreso. Aumentar frecuencia a 4-5 sesiones semanales para bajar SSRT.";
        return "ADAPTACIÓN INICIAL. Concentración fluctuante. Realizar sesiones en ambientes de bajo estímulo.";
    };

    /**
     * Componente Gráfico de Tendencia (SVG)
     */
    const TrendChart = () => {
        if (history.length < 2) return null;
        const data = [...history].reverse().slice(-10); // Últimos 10
        const maxSSRT = Math.max(...data.map(d => d.ssrt), 300);
        const minSSRT = Math.min(...data.map(d => d.ssrt), 150);
        const range = maxSSRT - minSSRT || 1;
        
        const width = 300;
        const height = 100;
        const padding = 20;
        
        const points = data.map((d, i) => {
            const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
            const y = height - ((d.ssrt - minSSRT) / range) * (height - padding * 2) - padding;
            return `${x},${y}`;
        }).join(' ');

        return (
            <div className="bracket-box" style={{marginBottom: '32px', background: 'linear-gradient(180deg, #0a1108 0%, #000 100%)'}}>
                <div className="onboarding-tag">Tendencia de inhibición (SSRT)</div>
                <svg viewBox={`0 0 ${width} ${height}`} style={{width: '100%', height: '120px'}}>
                    <polyline fill="none" stroke="#8eff71" strokeWidth="2" strokeLinejoin="round" points={points} />
                    {data.map((d, i) => {
                        const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
                        const y = height - ((d.ssrt - minSSRT) / range) * (height - padding * 2) - padding;
                        return (
                            <circle key={i} cx={x} cy={y} r="3" fill="#8eff71" />
                        );
                    })}
                </svg>
                <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#555', marginTop: '8px'}}>
                    <span>INICIO</span>
                    <span>PROGRESO ACTUAL</span>
                </div>
            </div>
        );
    };

    const finishSession = () => {
        const finalRank = getRank();
        const feedback = getFeedback(metrics.ssrt, metrics.rtsd, metrics.fatigueDetected);
        const record: SessionRecord = {
            id: Date.now().toString(),
            date: Date.now(),
            ssrt: metrics.ssrt,
            accuracy: metrics.accuracy,
            rank: finalRank.label,
            rankColor: finalRank.color,
            rtsd: metrics.rtsd,
            feedback: feedback
        };
        const newHistory = [record, ...history].slice(0, 50);
        setHistory(newHistory);
        localStorage.setItem('neuro_focus_history', JSON.stringify(newHistory));
        setState('FINISHED');
    };

    const getRank = () => {
        if (metrics.fatigueDetected) return { label: 'FATIGA CRÍTICA', color: '#ff4d4d' };
        if (metrics.ssrt < 200) return { label: 'ELITE NEURAL', color: '#8eff71' };
        if (metrics.ssrt < 240) return { label: 'PRO ATHLETE', color: '#7DF9FF' };
        if (metrics.ssrt < 280) return { label: 'AMATEUR', color: '#FFAB40' };
        return { label: 'LOW FOCUS', color: '#404040' };
    };

    const rank = getRank();

    return (
        <div className="app-container" onClick={handleAction}>
            {/* Slide 1: Concepto */}
            {state === 'INTRO_1' && (
                <div className="onboarding-overlay">
                    <div className="onboarding-content" style={{justifyContent: 'center', textAlign: 'center'}}>
                        <span className="onboarding-tag">ENTRENAMIENTO COGNITIVO</span>
                        <h1 className="onboarding-title" style={{fontSize: '32px', color: 'var(--kinetic-neon)'}}>El neuro-freno de élite</h1>
                        
                        <div className="bracket-box" style={{margin: '20px 0', background: 'rgba(142, 255, 113, 0.02)'}}>
                            <p className="onboarding-text" style={{fontSize: '18px', margin: '0', color: '#fff'}}>
                                **Hoy iniciarás** el desarrollo de tu capacidad de frenado motor, esencial para anticipar y reaccionar ante estímulos críticos en competencia.
                            </p>
                        </div>

                        <div className="onboarding-footer" style={{marginTop: '30px', border: 'none'}}>
                            <button className="nav-btn" style={{width: '100%', borderRadius: '4px'}} onClick={(e) => { e.stopPropagation(); setState('INTRO_2'); }}>COMENZAR ENTRENAMIENTO</button>
                        </div>
                    </div>
                    <div className="developer-footer">Desarrollado por Psicólogo Patricio Rubilar M.</div>
                </div>
            )}

            {/* Slide 2: Tech Metrics */}
            {state === 'INTRO_2' && (
                <div className="onboarding-overlay">
                    <div className="onboarding-content">
                        <span className="onboarding-tag">Variables de medición</span>
                        <h1 className="onboarding-title">Métricas de rendimiento</h1>
                        <div className="onboarding-grid">
                            <div className="onboarding-card">
                                <span className="card-title">NEURAL SSRT</span>
                                <p className="card-desc">Stop Signal Reaction Time: Es el tiempo que tarda tu cerebro en frenar una acción motora. Menos es mejor.</p>
                            </div>
                            <div className="onboarding-card">
                                <span className="card-title">SSD D-SA</span>
                                <p className="card-desc">Dificultad Dinámica: El algoritmo te llevará al límite ajustando el retardo de la señal de stop.</p>
                            </div>
                        </div>
                        <div className="instruction-box" style={{background: '#111', padding: '20px', marginTop: '20px'}}>
                            <p style={{fontSize: '14px', marginBottom: '10px'}}>INSTRUCCIONES:</p>
                            <p style={{color: '#8eff71'}}>🟢 CLIC al ver el círculo verde.</p>
                            <p style={{color: '#ff4d4d'}}>🔴 NO CLIC si aparece la X ROJA.</p>
                        </div>
                        <div className="onboarding-footer">
                            <button className="nav-btn secondary" onClick={(e) => { e.stopPropagation(); setState('INTRO_1'); }}>VOLVER</button>
                            <div className="dots">⚪🟢</div>
                            <button className="nav-btn" onClick={(e) => { e.stopPropagation(); setState('DASHBOARD'); }}>ENTENDIDO</button>
                        </div>
                    </div>
                    <div className="developer-footer">Desarrollado por Psicólogo Patricio Rubilar M.</div>
                </div>
            )}

            {/* Dashboard: Historial */}
            {state === 'DASHBOARD' && (
                <div className="dashboard-container">
                    <div className="dashboard-header">
                        <div>
                            <h1 className="dash-title">Dashboard del atleta</h1>
                        </div>
                        <button className="nav-btn" onClick={(e) => { e.stopPropagation(); startTraining(); }}>NUEVA SESIÓN</button>
                    </div>

                    <div className="history-list">
                        <span className="onboarding-tag">Historial de rendimiento</span>
                        
                        <TrendChart />

                        {history.length === 0 && <p style={{color: '#555'}}>No hay sesiones registradas.</p>}
                        {history.map(record => (
                            <div key={record.id} className="history-item bracket-box" style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '20px', marginBottom: '12px'}}>
                                <div style={{display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center'}}>
                                    <div className="history-rank" style={{color: record.rankColor, fontSize: '13px', letterSpacing: '0.1em'}}>{record.rank}</div>
                                    <div className="card-desc" style={{fontSize: '11px'}}>{new Date(record.date).toLocaleDateString()}</div>
                                </div>
                                <div style={{display: 'flex', gap: '24px', margin: '12px 0'}}>
                                    <div className="history-ssrt-neon" style={{position: 'relative'}}>
                                        <div className="hud-label" style={{marginBottom: '4px'}}>
                                            SSRT 
                                            <span className="info-icon" style={{width: '10px', height: '10px', fontSize: '7px', marginLeft: '4px'}} 
                                                onClick={(e) => { e.stopPropagation(); setActiveDashboardInfo({id: record.id, type: 'SSRT'}); }}>i</span>
                                        </div>
                                        <div className="val">{(record.ssrt ?? 0).toFixed(0)}<span className="unit">ms</span></div>
                                        
                                        {activeDashboardInfo?.id === record.id && activeDashboardInfo?.type === 'SSRT' && (
                                            <div className="info-overlay-box" style={{left: '0', transform: 'none', width: '240px'}} onClick={(e) => e.stopPropagation()}>
                                                <p><strong>{METRIC_INFO.SSRT.title}:</strong> {METRIC_INFO.SSRT.desc}</p>
                                                <button className="nav-btn" style={{padding: '4px 8px', marginTop: '8px', fontSize: '9px'}} onClick={() => setActiveDashboardInfo(null)}>CERRAR</button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="history-ssrt-neon" style={{position: 'relative'}}>
                                        <div className="hud-label" style={{marginBottom: '4px'}}>
                                            RTSD 
                                            <span className="info-icon" style={{width: '10px', height: '10px', fontSize: '7px', marginLeft: '4px'}}
                                                onClick={(e) => { e.stopPropagation(); setActiveDashboardInfo({id: record.id, type: 'RTSD'}); }}>i</span>
                                        </div>
                                        <div className="val">{(record.rtsd ?? 0).toFixed(0)}<span className="unit">ms</span></div>

                                        {activeDashboardInfo?.id === record.id && activeDashboardInfo?.type === 'RTSD' && (
                                            <div className="info-overlay-box" style={{left: '0', transform: 'none', width: '240px'}} onClick={(e) => e.stopPropagation()}>
                                                <p><strong>{METRIC_INFO.RTSD.title}:</strong> {METRIC_INFO.RTSD.desc}</p>
                                                <button className="nav-btn" style={{padding: '4px 8px', marginTop: '8px', fontSize: '9px'}} onClick={() => setActiveDashboardInfo(null)}>CERRAR</button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="history-ssrt-neon" style={{position: 'relative'}}>
                                        <div className="hud-label" style={{marginBottom: '4px'}}>
                                            ACC 
                                            <span className="info-icon" style={{width: '11px', height: '11px', fontSize: '7px', marginLeft: '4px'}}
                                                onClick={(e) => { e.stopPropagation(); setActiveDashboardInfo({id: record.id, type: 'ACC'}); }}>i</span>
                                        </div>
                                        <div className="val">{((record.accuracy ?? 0)*100).toFixed(0)}<span className="unit">%</span></div>

                                        {activeDashboardInfo?.id === record.id && activeDashboardInfo?.type === 'ACC' && (
                                            <div className="info-overlay-box" style={{left: 'auto', right: '0', transform: 'none', width: '240px'}} onClick={(e) => e.stopPropagation()}>
                                                <p><strong>{METRIC_INFO.ACC.title}:</strong> {METRIC_INFO.ACC.desc}</p>
                                                <button className="nav-btn" style={{padding: '4px 8px', marginTop: '8px', fontSize: '9px'}} onClick={() => setActiveDashboardInfo(null)}>CERRAR</button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div style={{fontSize: '13px', color: '#ababab', fontStyle: 'italic', borderTop: '1px solid #1f1f1f', paddingTop: '12px', width: '100%', lineHeight: '1.4'}}>
                                    {record.feedback || "Sin feedback disponible."}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Training: Bucle */}
            {(state === 'IDLE' || state === 'COUNTDOWN' || state === 'GO' || state === 'STOP') && (
                <div className="training-layout">
                    <div className="hud-top">
                        <div className="hud-metric">
                            <span className="hud-label">NEURAL SSRT</span>
                            <span className="hud-value">{metrics.ssrt.toFixed(0)} ms</span>
                        </div>
                        <div className="hud-metric" style={{alignItems: 'flex-end'}}>
                            <span className="hud-label">PROGRESO {currentTrial}/{MAX_TRIALS}</span>
                            <div className="progress-track">
                                <div className="progress-fill" style={{width: `${(currentTrial/MAX_TRIALS)*100}%`}}></div>
                            </div>
                        </div>
                    </div>

                    <div className={`stimulus-main`}>
                        {state === 'COUNTDOWN' && <div className="onboarding-title" style={{fontSize: '120px'}}>{countdown}</div>}
                        {(state === 'GO' || state === 'STOP') && (
                            <div className={`stim-circle ${state}`}>
                                {state === 'STOP' && <span className="stim-icon">X</span>}
                            </div>
                        )}
                    </div>

                    {metrics.fatigueDetected && (
                        <div className="onboarding-tag pulse" style={{color: '#ff4d4d', position: 'absolute', bottom: '100px'}}>!!! ADVERTENCIA: FATIGA COGNITIVA !!!</div>
                    )}
                </div>
            )}

            {/* Results: Resumen */}
            {state === 'FINISHED' && (
                <div className="full-modal">
                    <span className="onboarding-tag">Protocolo completado</span>
                    <h1 className="onboarding-title">Sesión finalizada</h1>
                    <div className="bracket-box" style={{padding: '60px', margin: '40px 0', textAlign: 'center', position: 'relative'}}>
                        <div className="onboarding-tag" style={{color: rank.color, fontSize: '32px'}}>{rank.label}</div>
                        <div className="onboarding-grid" style={{marginTop: '40px', gridTemplateColumns: '1fr 1fr 1fr', width: '400px'}}>
                            <div style={{position: 'relative'}}>
                                <div className="hud-label" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'}}>
                                    SSRT FINAL
                                    <span className="info-icon" onClick={(e) => { e.stopPropagation(); setShowSSRTInfo(!showSSRTInfo); }}>i</span>
                                </div>
                                <div className="hud-value">{(metrics.ssrt ?? 0).toFixed(0)}ms</div>
                                
                                {showSSRTInfo && (
                                    <div className="info-overlay-box" onClick={(e) => e.stopPropagation()}>
                                        <p><strong>{METRIC_INFO.SSRT.title}:</strong> {METRIC_INFO.SSRT.desc}</p>
                                        <button className="nav-btn" style={{padding: '8px 16px', marginTop: '12px', fontSize: '10px'}} onClick={() => setShowSSRTInfo(false)}>CERRAR</button>
                                    </div>
                                )}
                            </div>
                            <div style={{position: 'relative'}}>
                                <div className="hud-label" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'}}>
                                    PRECISIÓN
                                    <span className="info-icon" onClick={(e) => { e.stopPropagation(); setShowACCInfo(!showACCInfo); }}>i</span>
                                </div>
                                <div className="hud-value">{((metrics.accuracy ?? 0)*100).toFixed(0)}%</div>
                                
                                {showACCInfo && (
                                    <div className="info-overlay-box" onClick={(e) => e.stopPropagation()}>
                                        <p><strong>{METRIC_INFO.ACC.title}:</strong> {METRIC_INFO.ACC.desc}</p>
                                        <button className="nav-btn" style={{padding: '8px 16px', marginTop: '12px', fontSize: '10px'}} onClick={() => setShowACCInfo(false)}>CERRAR</button>
                                    </div>
                                )}
                            </div>
                            <div style={{position: 'relative'}}>
                                <div className="hud-label" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'}}>
                                    SST-RTSD
                                    <span className="info-icon" onClick={(e) => { e.stopPropagation(); setShowRTSDInfo(!showRTSDInfo); }}>i</span>
                                </div>
                                <div className="hud-value">{(metrics.rtsd ?? 0).toFixed(0)}ms</div>
                                
                                {showRTSDInfo && (
                                    <div className="info-overlay-box" onClick={(e) => e.stopPropagation()}>
                                        <p><strong>{METRIC_INFO.RTSD.title}:</strong> {METRIC_INFO.RTSD.desc}</p>
                                        <button className="nav-btn" style={{padding: '8px 16px', marginTop: '12px', fontSize: '10px'}} onClick={() => setShowRTSDInfo(false)}>CERRAR</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <button className="nav-btn" onClick={(e) => { e.stopPropagation(); setState('DASHBOARD'); }}>IR AL DASHBOARD</button>
                </div>
            )}
        </div>
    );
};
