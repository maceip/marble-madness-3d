import os
import json
from PIL import Image
import numpy as np

os.makedirs('/Users/mac/marblemadness/www/sprites/font_chars', exist_ok=True)
os.makedirs('/Users/mac/marblemadness/www/sprites/marbles_blue', exist_ok=True)
os.makedirs('/Users/mac/marblemadness/www/sprites/marbles_red', exist_ok=True)
os.makedirs('/Users/mac/marblemadness/www/sprites/enemies_clean', exist_ok=True)
os.makedirs('/Users/mac/marblemadness/www/sprites/ui_clean', exist_ok=True)

# 1. EXTRACT 8x8 BITMAP FONT WITH TRANSPARENT BACKGROUND
font_img = Image.open('/Users/mac/marblemadness/Master System - Marble Madness (PAL) - Miscellaneous - Font.png').convert('RGBA')
arr = np.array(font_img)

# Font layout in sheet (149x212): 8x8 character grid (16 cols x ~4 rows per palette set)
# First set: white font with black drop shadow
# Let's create an atlas of A-Z, 0-9, special punctuation, and a combined 8x8 sprite sheet
# Characters in order:
# Row 0: 0 1 2 3 4 5 6 7 8 9 (or similar)
# Row 1: A B C D E F G H I J K L M
# Row 2: N O P Q R S T U V W X Y Z
# Let's slice all 8x8 cells and save font_sheet.png with transparent background!

# Background is pure blue [0, 0, 255] or dark blue [0, 91, 91]
mask_bg = ((arr[:, :, 0] <= 10) & (arr[:, :, 1] <= 10) & (arr[:, :, 2] >= 200)) | \
          ((arr[:, :, 0] <= 10) & (arr[:, :, 1] >= 80) & (arr[:, :, 1] <= 100) & (arr[:, :, 2] >= 80) & (arr[:, :, 2] <= 100))

arr_transparent = arr.copy()
arr_transparent[mask_bg, 3] = 0

clean_font_sheet = Image.fromarray(arr_transparent)
clean_font_sheet.save('/Users/mac/marblemadness/www/sprites/font_sheet.png')
print('Saved /Users/mac/marblemadness/www/sprites/font_sheet.png')

# 2. EXTRACT CLEAN MARBLE FRAMES (BLUE & RED)
marble_blue_img = Image.open('/Users/mac/marblemadness/Master System - Marble Madness (PAL) - Playable Characters - The Marble (1).png').convert('RGBA')
marble_red_img = Image.open('/Users/mac/marblemadness/Master System - Marble Madness (PAL) - Playable Characters - The Marble.png').convert('RGBA')

def clean_and_save_sheet(img, out_path):
    a = np.array(img)
    # Background in marble sheet is typically pure blue or teal
    bg = ((a[:, :, 0] <= 10) & (a[:, :, 1] <= 10) & (a[:, :, 2] >= 200)) | \
         ((a[:, :, 0] <= 10) & (a[:, :, 1] >= 80) & (a[:, :, 1] <= 100) & (a[:, :, 2] >= 80) & (a[:, :, 2] <= 100))
    a[bg, 3] = 0
    clean = Image.fromarray(a)
    clean.save(out_path)
    print('Saved', out_path)

clean_and_save_sheet(marble_blue_img, '/Users/mac/marblemadness/www/sprites/marble_blue_sheet.png')
clean_and_save_sheet(marble_red_img, '/Users/mac/marblemadness/www/sprites/marble_red_sheet.png')

# 3. EXTRACT ENEMIES SHEET
enemies_img = Image.open('/Users/mac/marblemadness/Master System - Marble Madness (PAL) - Miscellaneous - Enemies & Obstacles.png').convert('RGBA')
clean_and_save_sheet(enemies_img, '/Users/mac/marblemadness/www/sprites/enemies_sheet.png')

# 4. EXTRACT TITLE SCREEN RETRO LOGO AND GRAPHICS
title_img = Image.open('/Users/mac/marblemadness/Master System - Marble Madness (PAL) - Miscellaneous - Title Screen.png').convert('RGBA')
clean_and_save_sheet(title_img, '/Users/mac/marblemadness/www/sprites/title_sheet.png')

# Crop the retro title logo from title screen
# Master system title screen has the classic "MARBLE MADNESS" arcade logo
# Let's save a clean crop of the retro arcade logo and title graphic
t_arr = np.array(title_img)
# The title screen has the large 3D geometric Marble Madness logo at top
logo_crop = title_img.crop((12, 12, 260, 96))
clean_and_save_sheet(logo_crop, '/Users/mac/marblemadness/www/sprites/retro_logo.png')

print('All master sprite sheets extracted and cleaned successfully!')
