export const examples = [
  {
    id: 'rotated', name: 'Rotated maximum', entry: 'max_value_index',
    inputs: { array: '[5, 6, 7, 1, 2, 3, 4]' },
    code: `from typing import List


def max_value_index(array: List[int]) -> int:
    if not array:
        raise ValueError("array must not be empty")

    left, right = 0, len(array)

    while left < right:
        mid = (left + right) // 2
        if array[mid] >= array[0]:
            left = mid + 1
        else:
            right = mid

    return left - 1
`,
  },
  {
    id: 'binary', name: 'Binary search', entry: 'binary_search',
    inputs: { array: '[1, 3, 5, 7, 9, 11, 13]', target: '9' },
    code: `def binary_search(array, target):
    left, right = 0, len(array) - 1
    while left <= right:
        mid = (left + right) // 2
        if array[mid] == target:
            return mid
        if array[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1
`,
  },
  {
    id: 'reverse', name: 'In-place reverse', entry: 'reverse', inputs: { array: '[8, 2, 6, 1, 9]' },
    code: `def reverse(array):
    left, right = 0, len(array) - 1
    while left < right:
        array[left], array[right] = array[right], array[left]
        left += 1
        right -= 1
    return array
`,
  },
  {
    id: 'merge', name: 'Recursive merge sort', entry: 'merge_sort', inputs: { array: '[7, 2, 5, 1, 6, 3]' },
    code: `def merge_sort(array):
    if len(array) <= 1:
        return array
    mid = len(array) // 2
    left = merge_sort(array[:mid])
    right = merge_sort(array[mid:])
    return merge(left, right)


def merge(left, right):
    result = []
    i, j = 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i])
            i += 1
        else:
            result.append(right[j])
            j += 1
    result.extend(left[i:])
    result.extend(right[j:])
    return result
`,
  },
] as const;
