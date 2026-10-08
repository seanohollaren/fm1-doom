MEMORY { XIP (rx) : ORIGIN = 0x02000120, LENGTH = 0xF0000  RAM (rwx) : ORIGIN = 0x01C08000, LENGTH = 0x74000 }
SECTIONS {
  .text : { KEEP(*(.text.stubs)) *(.text*) *(.rodata*) . = ALIGN(4); _etext = .; } > XIP
  .data : { *(.data*) *(.sdata*) . = ALIGN(4); } > RAM AT > XIP
  .bss (NOLOAD) : { *(.bss*) *(.sbss*) *(COMMON) . = ALIGN(4); } > RAM
  /DISCARD/ : { *(.comment) *(.note*) *(.binary_info*) }
}
