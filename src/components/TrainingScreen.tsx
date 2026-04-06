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
    const [activeInfoPanel, setActiveInfoPanel] = useState<keyof typeof METRIC_INFO | null>(null);
    const [activeDashboardInfo, setActiveDashboardInfo] = useState<{id: string, type: keyof typeof METRIC_INFO} | null>(null);
    const [expandedSession, setExpandedSession] = useState<string | null>(null);

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
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
        const nextSSD = NeuroEngine.calculateNextSSD(ssdRef.current, success);
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

    const exportCSV = () => {
        if (history.length === 0) return;
        const headers = "Fecha,SSRT(ms),Precision(%),RTSD(ms),Categoria\n";
        const rows = history.map(r => {
            const date = new Date(r.date).toISOString().split('T')[0];
            return `${date},${r.ssrt.toFixed(0)},${(r.accuracy*100).toFixed(0)},${Math.round(r.rtsd)},${r.rank}`;
        }).join('\n');
        
        const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `neuro_focus_history_elite.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const rank = getRank();

    // Canvas Graphics Engine (Zero DOM Lag)
    useEffect(() => {
        if (!canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        // Fix Display Quality (Retina/High-DPI)
        const dpr = window.devicePixelRatio || 1;
        const logicalSize = 260;
        canvasRef.current.width = logicalSize * dpr;
        canvasRef.current.height = logicalSize * dpr;
        ctx.resetTransform();
        ctx.scale(dpr, dpr);

        let animationFrameId: number;

        const render = () => {
            ctx.clearRect(0, 0, logicalSize, logicalSize);

            if (state === 'GO' || state === 'STOP') {
                ctx.beginPath();
                ctx.arc(130, 130, 130, 0, 2 * Math.PI);
                ctx.fillStyle = state === 'GO' ? '#8eff71' : '#ff4d4d';
                ctx.fill();

                // Simulamos resplandor inmersivo a nivel de GPU
                ctx.save();
                ctx.shadowBlur = 30 * dpr; // Scale blur
                ctx.shadowColor = state === 'GO' ? 'rgba(142, 255, 113, 0.6)' : 'rgba(255, 77, 77, 0.6)';
                ctx.fill();
                ctx.restore();

                if (state === 'STOP') {
                    ctx.fillStyle = '#000';
                    ctx.font = 'bold 120px "Space Grotesk", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('X', 130, 138); // Ligero offset visual por fuente
                }
            } else if (state === 'COUNTDOWN') {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 120px "Space Grotesk", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(countdown.toString(), 130, 138);
            }
        };

        animationFrameId = requestAnimationFrame(render);

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [state, countdown]);

    return (
        <div className="app-container" onClick={handleAction}>
            {/* Slide 1: Concepto */}
            {state === 'INTRO_1' && (
                <div className="onboarding-overlay">
                    <div className="onboarding-content" style={{justifyContent: 'center', textAlign: 'center'}}>
                        <span className="onboarding-tag">SISTEMA NEURO-COGNITIVO</span>
                        <h1 className="onboarding-title" style={{fontSize: '32px', color: 'var(--kinetic-neon)', marginTop: '20px'}}>Entrenamiento de precisión para el sistema nervioso</h1>
                    </div>

                    {/* Bottom Nav Module */}
                    <div className="bottom-nav">
                        <button className="nav-btn module-btn" onClick={(e) => { e.stopPropagation(); setState('INTRO_2'); }}>ENTRENAR</button>
                        <button className="nav-btn module-btn secondary" onClick={(e) => { e.stopPropagation(); setState('DASHBOARD'); }}>DASHBOARD</button>
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
                    <div className="dashboard-header" style={{flexDirection: 'column', alignItems: 'flex-start', gap: '24px'}}>
                        <button className="nav-btn secondary" style={{padding: '8px 16px', fontSize: '10px'}} onClick={(e) => { e.stopPropagation(); setState('INTRO_1'); }}>← VOLVER</button>
                        <div style={{display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center'}}>
                            <h1 className="dash-title">Dashboard</h1>
                            <div style={{display: 'flex', gap: '12px'}}>
                                <button className="nav-btn secondary" style={{padding: '12px 16px', fontSize: '11px'}} onClick={(e) => { e.stopPropagation(); exportCSV(); }}>CSV ⬇</button>
                                <button className="nav-btn" style={{padding: '12px 16px', fontSize: '11px'}} onClick={(e) => { e.stopPropagation(); startTraining(); }}>SESIÓN</button>
                            </div>
                        </div>
                    </div>

                    <div className="history-list">
                        <span className="onboarding-tag">Historial de rendimiento</span>
                        
                        <TrendChart />

                        {history.length === 0 && <p style={{color: '#555'}}>No hay sesiones registradas.</p>}
                        {history.map(record => (
                            <div key={record.id} className="history-item bracket-box" style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '20px', marginBottom: '12px', cursor: 'pointer', transition: 'all 0.2s', borderLeft: expandedSession === record.id ? '2px solid var(--kinetic-neon)' : '1px solid transparent'}}
                                 onClick={() => setExpandedSession(expandedSession === record.id ? null : record.id)}>
                                <div style={{display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center'}}>
                                    <div className="history-rank" style={{color: record.rankColor, fontSize: '14px', letterSpacing: '0.1em'}}>{record.rank}</div>
                                    <div className="card-desc" style={{fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                                        {new Date(record.date).toLocaleDateString()}
                                        <span style={{fontSize: '14px'}}>{expandedSession === record.id ? '▲' : '▼'}</span>
                                    </div>
                                </div>
                                {expandedSession !== record.id && (
                                    <div style={{fontSize: '11px', color: 'var(--kinetic-neon)', marginTop: '4px', opacity: 0.8}}>
                                        Toca para ver métricas y resultados detallados.
                                    </div>
                                )}
                                
                                {expandedSession === record.id && (
                                    <div style={{width: '100%', marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px'}}>
                                        <div style={{display: 'flex', gap: '16px', margin: '12px 0', justifyContent: 'space-between'}}>
                                            <div className="history-ssrt-neon" style={{position: 'relative'}}>
                                                <div className="hud-label" style={{marginBottom: '4px'}}>
                                                    SSRT 
                                                    <span className="info-icon" style={{width: '10px', height: '10px', fontSize: '7px', marginLeft: '4px'}} 
                                                        onClick={(e) => { e.stopPropagation(); setActiveDashboardInfo({id: record.id, type: 'SSRT'}); }}>i</span>
                                                </div>
                                                <div className="val" style={{fontSize: '20px'}}>{(record.ssrt ?? 0).toFixed(0)}<span className="unit">ms</span></div>
                                            </div>

                                            <div className="history-ssrt-neon" style={{position: 'relative'}}>
                                                <div className="hud-label" style={{marginBottom: '4px'}}>
                                                    RTSD 
                                                    <span className="info-icon" style={{width: '10px', height: '10px', fontSize: '7px', marginLeft: '4px'}}
                                                        onClick={(e) => { e.stopPropagation(); setActiveDashboardInfo({id: record.id, type: 'RTSD'}); }}>i</span>
                                                </div>
                                                <div className="val" style={{fontSize: '20px'}}>{(record.rtsd ?? 0).toFixed(0)}<span className="unit">ms</span></div>
                                            </div>

                                            <div className="history-ssrt-neon" style={{position: 'relative'}}>
                                                <div className="hud-label" style={{marginBottom: '4px'}}>
                                                    ACC 
                                                    <span className="info-icon" style={{width: '11px', height: '11px', fontSize: '7px', marginLeft: '4px'}}
                                                        onClick={(e) => { e.stopPropagation(); setActiveDashboardInfo({id: record.id, type: 'ACC'}); }}>i</span>
                                                </div>
                                                <div className="val" style={{fontSize: '20px'}}>{((record.accuracy ?? 0)*100).toFixed(0)}<span className="unit">%</span></div>
                                            </div>
                                        </div>
                                        <div style={{fontSize: '13px', color: '#ababab', fontStyle: 'italic', borderTop: '1px solid #1f1f1f', paddingTop: '12px', width: '100%', lineHeight: '1.4'}}>
                                            {record.feedback || "Sin feedback disponible."}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Fixed Modal Info Panel for Dashboard */}
                    {activeDashboardInfo && (
                        <div className="fixed-info-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="fixed-info-content bracket-box">
                                <h3 style={{color: 'var(--kinetic-neon)', marginBottom: '10px', fontSize: '14px', textTransform: 'uppercase'}}>{METRIC_INFO[activeDashboardInfo.type].title}</h3>
                                <p style={{fontSize: '14px', lineHeight: '1.6', color: '#dedede'}}>{METRIC_INFO[activeDashboardInfo.type].desc}</p>
                                <button className="nav-btn" style={{marginTop: '20px', width: '100%'}} onClick={() => setActiveDashboardInfo(null)}>ENTENDIDO</button>
                            </div>
                        </div>
                    )}
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
                        <canvas ref={canvasRef} width={260} height={260} style={{display: 'block'}}></canvas>
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
                    <div className="bracket-box" style={{padding: '30px', margin: '20px 0', textAlign: 'center', position: 'relative', width: '100%', maxWidth: '500px'}}>
                        <div className="onboarding-tag" style={{color: rank.color, fontSize: '24px'}}>{rank.label}</div>
                        
                        <div className="onboarding-grid" style={{marginTop: '30px', gridTemplateColumns: '1fr 1fr 1fr'}}>
                            <div style={{position: 'relative'}}>
                                <div className="hud-label" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'}}>
                                    SSRT
                                    <span className="info-icon" onClick={(e) => { e.stopPropagation(); setActiveInfoPanel('SSRT'); }}>i</span>
                                </div>
                                <div className="hud-value">{(metrics.ssrt ?? 0).toFixed(0)}<span style={{fontSize: '12px'}}>ms</span></div>
                            </div>
                            <div style={{position: 'relative'}}>
                                <div className="hud-label" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'}}>
                                    PRECISIÓN
                                    <span className="info-icon" onClick={(e) => { e.stopPropagation(); setActiveInfoPanel('ACC'); }}>i</span>
                                </div>
                                <div className="hud-value">{((metrics.accuracy ?? 0)*100).toFixed(0)}<span style={{fontSize: '12px'}}>%</span></div>
                            </div>
                            <div style={{position: 'relative'}}>
                                <div className="hud-label" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'}}>
                                    RTSD
                                    <span className="info-icon" onClick={(e) => { e.stopPropagation(); setActiveInfoPanel('RTSD'); }}>i</span>
                                </div>
                                <div className="hud-value">{(metrics.rtsd ?? 0).toFixed(0)}<span style={{fontSize: '12px'}}>ms</span></div>
                            </div>
                        </div>

                        {/* Detailed feedback */}
                        <div style={{marginTop: '30px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)'}}>
                            <span className="onboarding-tag">Análisis del Atleta</span>
                            <p style={{fontSize: '15px', color: '#ababab', marginTop: '10px', lineHeight: '1.5'}}>
                                {getFeedback(metrics.ssrt, metrics.rtsd, metrics.fatigueDetected)}
                            </p>
                        </div>
                    </div>
                    
                    {/* Fixed Modal Info Panel */}
                    {activeInfoPanel && (
                        <div className="fixed-info-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="fixed-info-content bracket-box">
                                <h3 style={{color: 'var(--kinetic-neon)', marginBottom: '10px', fontSize: '14px', textTransform: 'uppercase'}}>{METRIC_INFO[activeInfoPanel].title}</h3>
                                <p style={{fontSize: '14px', lineHeight: '1.6', color: '#dedede'}}>{METRIC_INFO[activeInfoPanel].desc}</p>
                                <button className="nav-btn" style={{marginTop: '20px', width: '100%'}} onClick={() => setActiveInfoPanel(null)}>ENTENDIDO</button>
                            </div>
                        </div>
                    )}

                    <button className="nav-btn" onClick={(e) => { e.stopPropagation(); setState('DASHBOARD'); }}>IR AL DASHBOARD</button>
                </div>
            )}
        </div>
    );
};
