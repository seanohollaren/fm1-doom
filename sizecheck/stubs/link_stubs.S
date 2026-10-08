	.section .text.stubs,"ax",@progbits
	.globl I_BindInputVariables
I_BindInputVariables:
	.globl I_BindVideoVariables
I_BindVideoVariables:
	.globl I_CheckIsScreensaver
I_CheckIsScreensaver:
	.globl I_Endoom
I_Endoom:
	.globl I_GetMemoryValue
I_GetMemoryValue:
	.globl I_GetTime
I_GetTime:
	.globl I_GetTimeMS
I_GetTimeMS:
	.globl I_GraphicsCheckCommandLine
I_GraphicsCheckCommandLine:
	.globl I_InitGraphics
I_InitGraphics:
	.globl I_InitTimer
I_InitTimer:
	.globl I_PicoSoundFade
I_PicoSoundFade:
	.globl I_PicoSoundFading
I_PicoSoundFading:
	.globl I_PrintBanner
I_PrintBanner:
	.globl I_PrintStartupBanner
I_PrintStartupBanner:
	.globl I_Quit
I_Quit:
	.globl I_SetPaletteNum
I_SetPaletteNum:
	.globl I_SetWindowTitle
I_SetWindowTitle:
	.globl I_Sleep
I_Sleep:
	.globl I_StartFrame
I_StartFrame:
	.globl I_StartTextInput
I_StartTextInput:
	.globl I_StartTic
I_StartTic:
	.globl I_StopTextInput
I_StopTextInput:
	.globl I_Tactile
I_Tactile:
	.globl I_UpdateNoBlit
I_UpdateNoBlit:
	.globl I_VideoBuffer
I_VideoBuffer:
	.globl I_ZoneBase
I_ZoneBase:
	.globl OPL_Delay
OPL_Delay:
	.globl __breakpoint
__breakpoint:
	.globl calloc
calloc:
	.globl display_frame_freed
display_frame_freed:
	.globl fm1_interp
fm1_interp:
	.globl frame_buffer
frame_buffer:
	.globl free
free:
	.globl get_core_num
get_core_num:
	.globl hard_assertion_failure
hard_assertion_failure:
	.globl interp_in_use
interp_in_use:
	.globl malloc
malloc:
	.globl net_client_connected
net_client_connected:
	.globl next_frame_index
next_frame_index:
	.globl next_overlay_index
next_overlay_index:
	.globl next_video_type
next_video_type:
	.globl opl_pico_driver
opl_pico_driver:
	.globl panic
panic:
	.globl panic_unsupported
panic_unsupported:
	.globl picoflash_sector_program
picoflash_sector_program:
	.globl piconet_client_check_for_dropped_connection
piconet_client_check_for_dropped_connection:
	.globl piconet_get_lobby_state
piconet_get_lobby_state:
	.globl piconet_maybe_recv_tic
piconet_maybe_recv_tic:
	.globl piconet_new_local_tic
piconet_new_local_tic:
	.globl piconet_start_client
piconet_start_client:
	.globl piconet_start_game
piconet_start_game:
	.globl piconet_start_host
piconet_start_host:
	.globl piconet_stop
piconet_stop:
	.globl printf
printf:
	.globl putchar
putchar:
	.globl puts
puts:
	.globl render_frame_ready
render_frame_ready:
	.globl restore_interrupts
restore_interrupts:
	.globl save_and_disable_interrupts
save_and_disable_interrupts:
	.globl screensaver_mode
screensaver_mode:
	.globl screenvisible
screenvisible:
	.globl sem_acquire_blocking
sem_acquire_blocking:
	.globl sem_acquire_timeout_ms
sem_acquire_timeout_ms:
	.globl sem_available
sem_available:
	.globl sem_init_alternative
sem_init_alternative:
	.globl sem_release
sem_release:
	.globl snprintf
snprintf:
	.globl sound_pico_module
sound_pico_module:
	.globl spin_lock_blocking
spin_lock_blocking:
	.globl spin_lock_instance
spin_lock_instance:
	.globl spin_unlock
spin_unlock:
	.globl sprintf
sprintf:
	.globl sscanf
sscanf:
	.globl time_us_32
time_us_32:
	.globl usegamma
usegamma:
	.globl vsnprintf
vsnprintf:
	.globl wipe_linelookup
wipe_linelookup:
	.globl wipe_min
wipe_min:
	.globl wipe_yoffsets
wipe_yoffsets:
	.globl wipe_yoffsets_raw
wipe_yoffsets_raw:
	rts
	.globl fm1_entry
fm1_entry:
	call D_DoomMain
