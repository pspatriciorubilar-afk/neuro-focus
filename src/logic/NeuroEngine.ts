/**
 * NeuroEngine: Núcleo de cálculo neurocientífico (Web Edition).
 */
export interface TrainingMetrics {
  ssrt: number;
  accuracy: number;
  currentSSD: number;
  fatigueDetected: boolean;
  rtsd: number;
}

export const NeuroEngine = {
  /**
   * Filtro de Anticipación (milisegundos).
   * Respuestas inferiores a este valor se consideran impulsivas/adivinanzas.
   */
  ANTICIPATION_THRESHOLD: 150,

  /**
   * Cálculo de SSRT (Integration Method - Robust Version).
   * n = p(Respond|Signal)
   * SSRT = nth_GoRT - meanSSD [Verbruggen et al., 2019]
   */
  calculateSSRT(goRTs: number[], pError: number, meanSSD: number): number {
    const validRTs = goRTs.filter(rt => rt >= this.ANTICIPATION_THRESHOLD);
    if (validRTs.length === 0) return 0;
    
    // Si pError es 0 o 1, ajustamos ligeramente para estabilidad [Karayanidis, 2009]
    const p = Math.max(0.01, Math.min(0.99, pError));
    
    const sortedRTs = [...validRTs].sort((a, b) => a - b);
    const index = Math.floor(p * sortedRTs.length);
    const nthRT = sortedRTs[Math.min(index, sortedRTs.length - 1)];
    
    return Math.max(50, nthRT - meanSSD);
  },

  /**
   * D-SA 2.0 (Dynamic Scaling Algorithm) - Asymmetric Staircase for 35% Error Equilibrium.
   * Para converger a 35% error (P(err)=0.35, P(succ)=0.65): 
   * Aumentar SSD tras éxito (frenado exitoso) -> más difícil.
   * Disminuir SSD tras fallo (respuesta impulsiva) -> más fácil.
   * P_error * StepDown = P_succ * StepUp -> 0.35 * 65ms = 0.65 * 35ms.
   */
  calculateNextSSD(currentSSD: number, lastTrialSuccess: boolean): number {
    const stepUp = 35;   // Si frenó con éxito: Aumentar SSD en 35ms
    const stepDown = 65; // Si falló al frenar: Bajar SSD en 65ms
    
    if (lastTrialSuccess) {
      return currentSSD + stepUp;
    } else {
      return Math.max(50, currentSSD - stepDown);
    }
  },

  /**
   * Detección de Fatiga (2 Desviaciones Estándar).
   */
  checkCognitiveFatigue(lastRT: number, history: number[]): boolean {
    if (history.length < 10) return false;
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const stdDev = Math.sqrt(
      history.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / history.length
    );
    return lastRT > mean + 2 * stdDev;
  },

  /**
   * Cálculo de Variabilidad Neural (RTSD).
   */
  calculateRTSD(history: number[]): number {
    if (history.length < 5) return 0;
    const valid = history.filter(rt => rt >= this.ANTICIPATION_THRESHOLD);
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    return Math.sqrt(
      valid.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / valid.length
    );
  }
};
