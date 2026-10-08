/* size-check stand-in for the RP2040 interpolator (a real port replaces these uses with plain C) */
#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct { volatile uint32_t accum[2], base[3], pop[3], peek[3], ctrl[2], add_raw[2], base01; } interp_hw_t;
extern interp_hw_t fm1_interp[2];
#define interp0_hw (&fm1_interp[0])
#define interp1_hw (&fm1_interp[1])
#define interp0 interp0_hw
#define interp1 interp1_hw
typedef struct { uint32_t ctrl; } interp_config;
static inline interp_config interp_default_config(void) { interp_config c = {0}; return c; }
static inline void interp_config_set_add_raw(interp_config *c, int v) { c->ctrl |= (uint32_t)v << 18; }
static inline void interp_config_set_shift(interp_config *c, unsigned v) { c->ctrl |= v; }
static inline void interp_config_set_mask(interp_config *c, unsigned a, unsigned b) { c->ctrl |= a << 5 | b << 10; }
static inline void interp_config_set_cross_input(interp_config *c, int v) { c->ctrl |= (uint32_t)v << 16; }
static inline void interp_config_set_signed(interp_config *c, int v) { c->ctrl |= (uint32_t)v << 15; }
static inline void interp_set_config(interp_hw_t *i, unsigned lane, interp_config *c) { i->ctrl[lane] = c->ctrl; }
#ifdef __cplusplus
}
#endif
