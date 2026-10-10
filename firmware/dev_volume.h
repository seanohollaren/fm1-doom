/* SPDX-License-Identifier: GPL-3.0-only */
/* FM-1 Doom: the MASTER knob as the game's volume (firmware/doom_dev.c includes this; firmware/tests/volume_test.c
 * tests it on a PC). The knob is an analogue input, 0..1023; the mapping is Felucca's own (its fx.c master_of_pot,
 * master.c): square law, and a smoothed reading so that a noisy or moving knob does not crackle.
 *
 *   dv_gain(k10)            knob reading -> gain in Q12: 0 (silent) .. 4088 (the level Felucca plays at full)
 *   dv_smooth(knob16, adc)  one poll: the smoothed knob (x16) moves an eighth of the way to the new reading;
 *                           a failed reading (adc < 0) changes nothing
 *   dv_sample(s, gain)      one 16-bit sample of the game's mix -> the codec's 24-bit word
 */
static inline uint32_t dv_gain(uint32_t k10)
{
    if (k10 > 1023u)
        k10 = 1023u;
    return (k10 * k10) >> 8;             /* 0..15 give 0: the bottom of the knob is off */
}
static inline int32_t dv_smooth(int32_t knob16, int32_t adc)
{
    return adc < 0 ? knob16 : knob16 + (adc * 16 - knob16) / 8;
}
/* at full gain this is the mix shifted up 7 bits, Felucca's -6 dBFS ceiling: |s * gain| <= 32768 * 4088 < 2^31 */
static inline int32_t dv_sample(int16_t s, uint32_t gain_q12)
{
    return ((int32_t)s * (int32_t)gain_q12) >> 5;
}
