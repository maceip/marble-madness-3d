import os
from PIL import Image
import numpy as np

def remove_backgrounds(img):
    rgba = img.convert('RGBA')
    arr = np.array(rgba)
    
    # Green background
    mask_green = (arr[:, :, 0] <= 70) & (arr[:, :, 1] >= 160) & (arr[:, :, 2] <= 70)
    # Teal background
    mask_teal = (arr[:, :, 0] <= 30) & (arr[:, :, 1] >= 65) & (arr[:, :, 1] <= 115) & (arr[:, :, 2] >= 65) & (arr[:, :, 2] <= 115)
    
    arr[mask_green | mask_teal, 3] = 0
    return Image.fromarray(arr)

def make_red_variant(img):
    rgba = img.convert('RGBA')
    arr = np.array(rgba)
    
    # Swap blue channel with red channel for blue parts
    blue_pixels = (arr[:, :, 2] > 140) & (arr[:, :, 0] < 100)
    arr[blue_pixels, 0] = arr[blue_pixels, 2] # Set red to high
    arr[blue_pixels, 2] = 20                 # Drop blue
    
    return Image.fromarray(arr)

marble_blue_raw = Image.open('/Users/mac/marblemadness/Master System - Marble Madness (PAL) - Playable Characters - The Marble (1).png')
clean_marble_blue = remove_backgrounds(marble_blue_raw)
clean_marble_red = make_red_variant(clean_marble_blue)

# Save 7 frames
for i in range(7):
    x0 = i * 24
    box = (x0 + 2, 50, x0 + 22, 72)
    cb = clean_marble_blue.crop(box)
    cr = clean_marble_red.crop(box)
    cb.save(f'/Users/mac/marblemadness/www/sprites/marbles_blue/frame_{i:02d}.png')
    cr.save(f'/Users/mac/marblemadness/www/sprites/marbles_red/frame_{i:02d}.png')

for i in range(7):
    x0 = i * 24
    box = (x0 + 2, 50, x0 + 22, 72)
    cb = clean_marble_blue.crop(box)
    cr = clean_marble_red.crop(box)
    cb.save(f'/Users/mac/marblemadness/www/sprites/marbles_blue/frame_{i+7:02d}.png')
    cr.save(f'/Users/mac/marblemadness/www/sprites/marbles_red/frame_{i+7:02d}.png')

print("Created distinct blue and red rolling sprite sequences!")
