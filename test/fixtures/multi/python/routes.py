@router.get("/items/{id}")
async def get_item(id):
    return fetch(id)

class Handlers:
    @staticmethod
    @cache
    def helper(x):
        return x * 2
